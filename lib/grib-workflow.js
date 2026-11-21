const { createHash, randomUUID } = require('node:crypto');
const { mkdir, readFile, writeFile, rename, stat, statfs, open, rm, readdir, realpath } = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const { checkResources, validateResourceBudget } = require('./resources');
async function sha256(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
// Empreinte du moteur mémorisée par (chemin, taille, mtime) : le binaire ne change pas entre deux ticks.
const engineDigests = new Map();
async function engineDigest(file) {
  const { size, mtimeMs } = await stat(file), key = `${file}:${size}:${mtimeMs}`;
  if (!engineDigests.has(key)) engineDigests.set(key, await sha256(file));
  return engineDigests.get(key);
}
async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true }); const temporary = file + '.tmp-' + randomUUID();
  try { await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
async function json(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; } }
function runDirectory(root, model, time) {
  if (!/^[\w]+$/.test(model) || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(time) || !Number.isFinite(Date.parse(time)) || new Date(time).toISOString().replace('.000Z', 'Z') !== time) throw new Error('Invalid model/run path');
  return path.join(path.resolve(root), model, time.slice(0, 4), time.slice(5, 7), time.slice(8, 10), time.slice(11, 13) + '00Z');
}
async function locked(directory, task) {
  const file = path.join(directory, 'lock.json'), token = randomUUID(); let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { handle = await open(file, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await json(file);
      if (!owner?.pid) throw new Error('Ingestion lock is incomplete; manual inspection required');
      try { process.kill(owner.pid, 0); throw new Error('Run ingestion already active'); }
      catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
      if ((await json(file))?.token === owner.token) await rm(file, { force: true });
    }
  }
  if (!handle) throw new Error('Unable to acquire ingestion lock');
  await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
  try { return await task(); }
  finally { await handle.close(); if ((await json(file))?.token === token) await rm(file, { force: true }); }
}
function inputPath(directory, source) { return path.join(directory, source.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 140) + '-' + createHash('sha256').update(source.url).digest('hex').slice(0, 12) + '.grib2'); }
async function cached(source, file) {
  const receipt = await json(file + '.json');
  if (receipt && receipt.url === source.url && receipt.bytes === source.bytes && receipt.etag === source.etag) {
    try { return (await stat(file)).size === source.bytes && await sha256(file) === receipt.sha256; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return false;
}
async function download(source, file, options) {
  if (await cached(source, file)) { options.event?.('download-cached', { name: source.name, bytes: source.bytes }); return; }
  const temporary = file + '.part-' + randomUUID();
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    try {
      const response = await (options.fetcher ?? fetch)(source.url, { signal: AbortSignal.timeout(options.timeoutMs ?? 180000) });
      if (!response.ok || !response.body) throw new Error(`GRIB download HTTP ${response.status}`);
      let bytes = 0;
      const counter = new Transform({ transform(chunk, encoding, done) { bytes += chunk.length; done(bytes > source.bytes ? new Error('GRIB exceeds catalogue size') : null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(temporary, { flags: 'wx' }));
      if (bytes !== source.bytes) throw new Error('Truncated GRIB download');
      const handle = await open(temporary), magic = Buffer.alloc(4);
      try { await handle.read(magic, 0, 4, 0); } finally { await handle.close(); }
      if (magic.toString() !== 'GRIB') throw new Error('Source is not a GRIB file');
      await rename(temporary, file); await atomicJson(file + '.json', { ...source, sha256: await sha256(file) });
      options.event?.('downloaded', { name: source.name, bytes, durationMs: performance.now() - started }); return;
    } catch (error) {
      options.event?.('download-failed', { name: source.name, error: error.message, durationMs: performance.now() - started });
      await rm(temporary, { force: true });
      if (attempt >= (options.retries ?? 2)) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 5000)));
    }
  }
}
async function verify(run) {
  for (const file of run.files) if ((await stat(file.file)).size !== file.bytes || await sha256(file.file) !== file.sha256) throw new Error('Published OM is missing or has changed');
}
async function latest(root, run) {
  for (const name of ['in-progress.json', 'latest.json']) {
    const file = path.join(root, run.model, name), current = await json(file);
    if (!current || Date.parse(current.reference_time) <= Date.parse(run.reference_time)) await atomicJson(file, run);
  }
}
async function validateConvertedRun(result, plan, options) {
  if (result?.schemaVersion !== 1 || result.completed !== true || result.model !== options.model || result.reference_time !== plan.referenceTime || !Array.isArray(result.files) || !Array.isArray(result.valid_times)) throw new Error('Invalid engine result');
  const expected = [...plan.validTimes].sort(), actual = [...result.valid_times].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual) || result.files.length !== expected.length) throw new Error('Converted run does not cover all expected valid times');
  if (new Set(result.files.map(file => file.validTime)).size !== expected.length) throw new Error('Invalid engine output: duplicate valid times');
  const staging = path.resolve(options.storageDirectory, '.staging', options.model);
  const output = path.resolve(path.dirname(result.files[0].file));
  if (!output.startsWith(staging + path.sep)) throw new Error('Engine output outside staging');
  const realStaging = await realpath(staging), realOutput = await realpath(output);
  if (!realOutput.startsWith(realStaging + path.sep)) throw new Error('Engine output outside staging');
  const selected = new Set();
  for (const file of result.files) {
    if (path.resolve(path.dirname(file.file)) !== output || !Array.isArray(file.variables) || !file.variables.length || !expected.includes(file.validTime)) throw new Error('Invalid engine output');
    if (file.variables.some(variable => !options.variables.includes(variable))) throw new Error('Invalid engine output: unselected variable');
    if (path.dirname(await realpath(file.file)) !== realOutput) throw new Error('Engine output outside staging');
    const stem = file.validTime.replace(/:/g, '').replace(/00Z$/, '');
    if (path.basename(file.file) !== stem + '.om') throw new Error('Invalid engine filename');
    for (const variable of file.variables) selected.add(variable);
  }
  if (options.variables.some(variable => !selected.has(variable))) throw new Error('Missing selected variable in converted run');
  return {output: realOutput, actual};
}

/** Converter is injected: this package never decodes GRIB or writes OM arrays. */
async function ingestWorkflow(plan, options) {
  if (typeof options.convert !== 'function') throw new Error('A registered GRIB converter is required');
  if (plan.missing.length || !plan.files.length) throw new Error('Run packages are not fully published');
  if (!Array.isArray(options.variables) || !options.variables.length || new Set(options.variables).size !== options.variables.length) throw new Error('An explicit unique variable selection is required');
  if (options.resources) validateResourceBudget(options.resources);
  if (!Number.isSafeInteger(options.retries ?? 2) || (options.retries ?? 2) < 0 || (options.retries ?? 2) > 100) throw new Error('Invalid download retries');
  if (!Array.isArray(plan.validTimes) || !plan.validTimes.length || new Set(plan.validTimes).size !== plan.validTimes.length) throw new Error('Invalid expected valid times');
  const engine = options.engine ?? {};
  const candidate = [engine.command, ...(engine.args ?? [])].find(p => typeof p === 'string' && path.isAbsolute(p) && path.basename(p) === 'mf-ingestion');
  const engineSha256 = candidate ? await engineDigest(candidate) : undefined;
  const signature = createHash('sha256').update(JSON.stringify({ version: 1, engineSha256, engine: engine.command, engineArgs: engine.args, referenceTime: plan.referenceTime, files: plan.files, rules: options.rules, variables: options.variables, maxForecastHour: options.maxForecastHour, expectedDimensions: options.expectedDimensions, unknownFields: options.unknownFields ?? 'report' })).digest('hex');
  const destination = runDirectory(options.storageDirectory, options.model, plan.referenceTime);
  const work = runDirectory(options.workDirectory, options.model, plan.referenceTime); await mkdir(work, { recursive: true });
  const state = (phase, detail = {}) => { options.event?.(phase, detail); return atomicJson(path.join(work, 'state.json'), { phase, signature, referenceTime: plan.referenceTime, updatedAt: new Date().toISOString(), detail }); };
  return locked(work, async () => {
    try {
      const published = await json(path.join(destination, 'meta.json'));
      if (published) {
        if (published.signature !== signature) throw new Error('Immutable run has a different configuration; use another model namespace');
        if (published.model !== options.model || published.reference_time !== plan.referenceTime || published.files.some(f => path.dirname(f.file) !== destination)) throw new Error('Invalid published run manifest');
        await verify(published); await state('indexing'); await options.register(published); await latest(path.resolve(options.storageDirectory), published); await state('complete'); return published;
      }
      const inputs = path.join(work, 'inputs'); await mkdir(options.storageDirectory, { recursive: true }); await state('preparing');
      const estimate = options.expectedDimensions ? options.expectedDimensions[0] * options.expectedDimensions[1] * plan.validTimes.length * options.variables.length * 8 : 0;
      const prepare = async () => {
        await state('downloading'); await mkdir(inputs, { recursive: true }); let needed = 0;
        for (const file of plan.files) {
          if (path.basename(file.name) !== file.name || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error('Unsafe GRIB source entry');
          if (options.maxFileSize && file.bytes > options.maxFileSize) throw new Error('GRIB exceeds configured maximum file size');
          if (!await cached(file, inputPath(inputs, file))) needed += file.bytes;
        }
        const space = await statfs(work), output = await statfs(options.storageDirectory);
        const reserve = options.resources?.diskReserveBytes ?? 256 * 1024 ** 2;
        const required = (await stat(work)).dev === (await stat(options.storageDirectory)).dev ? needed + estimate + reserve : needed + reserve;
        if (required > space.bavail * space.bsize || estimate + reserve > output.bavail * output.bsize) throw new Error('Insufficient disk space for GRIB bytes plus estimated OM output and reserve');
        const concurrency = options.downloadConcurrency ?? 1;
        if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Invalid download concurrency');
        let cursor = 0, failure;
        const worker = async () => { while (!failure && cursor < plan.files.length) { const file = plan.files[cursor++]; try {
          const task = () => download(file, inputPath(inputs, file), options);
          if (options.queue) await options.queue.add(task, { timeout: ((options.timeoutMs ?? 180000) + 10000) * ((options.retries ?? 2) + 1) }); else await task();
        } catch (error) { failure = error; } } };
        await Promise.all(Array.from({ length: concurrency }, worker)); if (failure) throw failure;
      };
      if (options.prepare) await options.prepare(prepare); else await prepare();
      await state('conversion-queued');
      const convert = async () => {
        await state('resources', await checkResources(options.storageDirectory, estimate, options.resources ?? { memoryBytes: 64 * 1024 ** 2, memoryReserveBytes: 0 }));
        await state('converting', {expectedFiles:plan.validTimes.length}); const started = performance.now();
        const result = await options.convert({ model: options.model, referenceTime: plan.referenceTime, inputs: plan.files.map(file => inputPath(inputs, file)), stagingDirectory: path.join(path.resolve(options.storageDirectory), '.staging', options.model), rules: options.rules, variables: options.variables, maxForecastHour: options.maxForecastHour, expectedDimensions: options.expectedDimensions, unknownFields: options.unknownFields ?? 'report', onOutput: file => options.event?.('output-visible', file) }, engine);
        if (!Array.isArray(result?.files)) throw new Error('Invalid engine result');
        options.event?.('converted', { durationMs: performance.now() - started, timings: result.timings, resources: result.resources, files: result.files.length, bytes: result.files.reduce((sum, file) => sum + file.bytes, 0) }); return result;
      };
      const result = options.conversion ? await options.conversion(convert) : await convert();
      const {output, actual} = await validateConvertedRun(result, plan, options);
      await state('validating'); const files = [];
      for (const file of result.files) {
        const stem = file.validTime.replace(/:/g, '').replace(/00Z$/, '');
        if (path.basename(file.file) !== stem + '.om') throw new Error('Invalid engine filename');
        const bytes = (await stat(file.file)).size; if (bytes <= 3) throw new Error('Empty OM output');
        const hour = (Date.parse(file.validTime) - Date.parse(plan.referenceTime)) / 3600000;
        await rename(path.join(output, stem + '.fields.json'), path.join(output, String(hour).padStart(3, '0') + 'H.fields.json'));
        files.push({ ...file, file: path.join(destination, path.basename(file.file)), bytes, sha256: await sha256(file.file) });
      }
      const run = { reference_time: plan.referenceTime, valid_times: actual, completed: true, model: options.model, signature, provenance: { engineSha256, ecCodesVersion: result.ecCodesVersion, buildProfile: result.buildProfile, timings: result.timings, sourceFiles: await Promise.all(plan.files.map(async file => ({ ...file, sha256: await sha256(inputPath(inputs, file)) }))) }, variables: [...new Set(files.flatMap(file => file.variables))].sort(), files };
      await atomicJson(path.join(output, 'meta.json'), run); await state('publishing'); await mkdir(path.dirname(destination), { recursive: true }); await rename(output, destination);
      await state('indexing'); await options.register(run); await latest(path.resolve(options.storageDirectory), run); await state('complete', { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }); return run;
    } catch (error) { await state('failed', { error: error.message }); throw error; }
  });
}
async function pruneGribRuns(root, model, retentionHours, now = Date.now()) {
  if (!Number.isFinite(retentionHours) || retentionHours < 0) throw new Error('Invalid GRIB retention');
  let deleted = 0;
  async function walk(directory, depth) {
    let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (depth < 4) { for (const entry of entries) if (entry.isDirectory() && /^\d+(?:Z)?$/.test(entry.name)) await walk(path.join(directory, entry.name), depth + 1); return; }
    if (entries.some(entry => entry.name === 'lock.json')) return;
    const state = await json(path.join(directory, 'state.json'));
    const updatedAt = Date.parse(state?.updatedAt);
    if (state?.phase !== 'complete' || !Number.isFinite(updatedAt) || now - updatedAt < retentionHours * 3600000) return;
    const inputs = path.join(directory, 'inputs'); let files;
    try { files = await readdir(inputs); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const file of files) deleted += (await stat(path.join(inputs, file))).size;
    await rm(inputs, { recursive: true });
  }
  await walk(path.join(path.resolve(root), model), 0); return deleted;
}
module.exports = { ingestWorkflow, pruneGribRuns, atomicJson, sha256, runDirectory };
