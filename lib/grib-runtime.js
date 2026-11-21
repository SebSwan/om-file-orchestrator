const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { IngestionPipeline } = require('./ingestion-pipeline');
const { ingestWorkflow, pruneGribRuns } = require('./grib-workflow');
const meteofrance = require('./sources/meteofrance');
const {validateIngestionSettings} = require('./ingestion-validation');
const {usesForecastHistory} = require('./forecast-history');

// Internal coordinator of the single public orchestrator. No timer or database of its own.
class GribRuntime {
  constructor(owner) {
    this.owner = owner; this.sources = new Map([['meteofrance-grib', meteofrance]]);
    this.converters = new Map(); this.observers = new Set(); this.pending = new Map(); this.stopping = false;
    // Dernier run publié par modèle dans ce process : le revérifier (sha256 de toute la sortie) à chaque tick ne sert à rien.
    this.published = new Map();
    this.pipeline = new IngestionPipeline(owner.config.ingestion?.maxRuns ?? 2,
      owner.config.ingestion?.preparationConcurrency ?? 1,
      detail => this.emit({ model: 'all', phase: 'pipeline', detail }));
  }
  emit(event) { for (const listener of this.observers) try { listener(event); } catch (error) { this.owner.logger.warn('Ingestion observer failed', { error: String(error) }); } }
  registerConverter(name, converter) {
    if (!name || typeof converter?.convert !== 'function' || typeof converter?.loadRules !== 'function') throw new Error('Converter requires convert and loadRules');
    this.converters.set(name, converter);
  }
  registerSource(name, source) {
    if (!name || typeof source?.discover !== 'function' || typeof source?.sourceLayout !== 'function') throw new Error('Source requires discover and sourceLayout');
    this.sources.set(name, source);
  }
  async check(key, model) {
    if (this.owner._startPromise) await this.owner._startPromise;
    if (this.stopping || !model.enabled || model.managed === false) return;
    if (this.owner.fakeMode) throw new Error('GRIB ingestion is unavailable in fake mode');
    if (this.pending.has(key)) return this.pending.get(key);
    if (!this.pipeline.admit(key)) { this.emit({ model: key, phase: 'backpressure', detail: this.pipeline.snapshot() }); return { status: 'deferred' }; }
    const task = this.process(key, model); this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); this.pipeline.release(key); }
  }
  async process(key, model) {
    const owner = this.owner, settings = model.ingestion;
    try {
      const adapter = this.sources.get(settings.provider), converter = this.converters.get(settings.converter ?? 'grib-to-om');
      if (!adapter) throw new Error(`Unknown source: ${settings.provider}`);
      if (!converter) throw new Error('Register a GRIB converter before enabling ingestion');
      const layout = validateIngestionSettings(settings, owner.config, adapter);
      const rules = await converter.loadRules(settings.rulesFile);
      validateIngestionSettings(settings, owner.config, adapter, rules);
      owner.stats.lastCheck = new Date();
      const started = performance.now(); let plan;
      try { plan = await adapter.discover(settings); this.emit({ model: key, phase: 'catalogue', detail: { durationMs: performance.now() - started } }); }
      catch (error) { this.emit({ model: key, phase: 'catalogue-failed', detail: { durationMs: performance.now() - started, error: String(error) } }); throw error; }
      if (plan.missing.length) { this.emit({ model: key, phase: 'waiting', detail: { missing: plan.missing.length } }); return { status: 'waiting', missing: plan.missing }; }
      if (this.published.get(key) === plan.referenceTime) return { status: 'already-published', referenceTime: plan.referenceTime };
      try { const latest = JSON.parse(await readFile(path.join(owner.config.storage.cacheDir, key, 'latest.json'), 'utf8')); if (Date.parse(latest.reference_time) > Date.parse(plan.referenceTime)) return { status: 'older-run-skipped' }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const runStart = performance.now();
      const run = await ingestWorkflow(plan, {
        model: key, storageDirectory: owner.config.storage.cacheDir,
        workDirectory: settings.workDirectory ?? path.join(owner.config.storage.cacheDir, '.mf-ingestion'),
        engine: settings.engine ?? converter.engine, rules, variables: settings.variables, maxForecastHour: settings.maxForecastHour,
        convert: converter.convert.bind(converter), expectedDimensions: layout.dimensions,
        prepare: task => this.pipeline.preparation.run(task), conversion: task => this.pipeline.conversion.run(task),
        downloadConcurrency: settings.downloadConcurrency ?? 1, resources: settings.resources,
        unknownFields: settings.unknownFields, timeoutMs: settings.downloadTimeoutMs,
        queue: owner.downloadQueue, retries: owner.config.queue.retries, maxFileSize: settings.maxFileSize ?? owner.config.storage.maxFileSize,
        register: run => owner.registerPublishedRun(run),
        event: (phase, detail) => {
          this.emit({ model: key, phase, detail });
          if (phase === 'downloaded') { owner.stats.filesDownloaded++; owner.stats.gribBytesDownloaded = (owner.stats.gribBytesDownloaded ?? 0) + detail.bytes; }
          if (phase === 'download-cached') owner.stats.filesSkipped++;
          owner.logger.info('GRIB ingestion', { model: key, run: plan.referenceTime, phase, detail });
        }
      });
      this.published.set(key, run.reference_time);
      this.emit({ model: key, phase: 'run-complete', detail: { durationMs: performance.now() - runStart, referenceTime: run.reference_time, files: run.files.length } });
      await this.cleanup(key, model, true); return run;
    } catch (error) { owner.stats.errors++; throw error; }
  }
  async register(run) {
    const owner = this.owner;
    if (!owner.pathCache) throw new Error('LMDB must be enabled before publishing GRIB ingestion');
    if (usesForecastHistory(owner.modelConfig.models[run.model])) {
      for (const file of run.files) await owner.updateIndex(path.relative(path.resolve(owner.config.storage.cacheDir), file.file), file.file);
      return;
    }
    for (const file of run.files) {
      const key = file.validTime.replace(/:/g, '').replace(/00Z$/, '');
      const previous = owner.pathCache.get(run.model, key);
      if (previous === file.file) continue;
      const match = previous && /\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})(\d{2})Z\//.exec(previous);
      if (match && Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`) > Date.parse(run.reference_time)) continue;
      if (await owner.pathCache.set(run.model, key, file.file) !== true) { owner.stats.dbErrors++; throw new Error(`LMDB registration failed: ${run.model}/${key}`); }
      owner.stats.dbUpdates++;
    }
  }
  async cleanup(key, model, completed = false) {
    if (!model.ingestion?.provider || (!completed && this.pending.has(key))) return;
    const bytes = await pruneGribRuns(model.ingestion.workDirectory ?? path.join(this.owner.config.storage.cacheDir, '.mf-ingestion'), key, model.ingestion.gribRetentionHours ?? 24);
    if (bytes) this.emit({ model: key, phase: 'grib-pruned', detail: { bytes } });
  }
  async stop() { this.stopping = true; await Promise.allSettled(this.pending.values()); }
}
module.exports = { GribRuntime };
