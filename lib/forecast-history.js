const { existsSync, rmdirSync, unlinkSync } = require('node:fs');
const { readdir } = require('node:fs/promises');
const path = require('node:path');
const {formatTimestampKey, parseTimestampKey, runFromPath} = require('./time-paths');

const HOUR = 3_600_000;
const HISTORY_AGE = 36 * HOUR;
const FILE_GRACE = 15 * 60_000;
const SYNC_INTERVAL = 30_000;

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function modelSteps(directory, depth = 0) {
  const entries = await directoryEntries(directory);
  if (depth < 4) {
    const format = [/^\d{4}$/, /^\d{2}$/, /^\d{2}$/, /^\d{4}Z$/][depth];
    const folders = entries.filter((entry) => entry.isDirectory() && format.test(entry.name));
    return (await Promise.all(folders.map((folder) => modelSteps(path.join(directory, folder.name), depth + 1)))).flat();
  }
  const run = Date.parse(runFromPath(directory + '/') ?? '');
  return entries.flatMap((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.om')) return [];
    const key = entry.name.slice(0, -3);
    const valid = parseTimestampKey(key);
    if (!Number.isFinite(run) || !Number.isFinite(valid) || valid < run || formatTimestampKey(valid) !== key) return [];
    return [{ key, file: path.join(directory, entry.name), valid, run }];
  });
}

class ForecastHistory {
  validated = new Set();

  constructor(cache, root, model, validate, report, inFlight) {
    Object.assign(this, {cache, root, model, validate, report, inFlight});
    this.state = cache.lmdb.openDB({ name: 'forecast-history' });
  }

  shouldDownload(validTime, referenceTime) {
    const valid = Date.parse(validTime);
    const run = Date.parse(referenceTime);
    if (!Number.isFinite(valid) || !Number.isFinite(run)) return true;
    const active = this.state.get(this.model)?.activeRun;
    if (active !== undefined && valid < active - HISTORY_AGE) return false;
    const selected = this.cache.dbs[this.model].get(formatTimestampKey(valid));
    return !selected || !existsSync(selected) || !(Date.parse(runFromPath(selected) ?? '') >= run);
  }

  async sync(now = Date.now()) {
    const state = this.state;
    const revision = state.get(this.model)?.revision ?? 0;
    const files = await modelSteps(path.resolve(this.root, this.model));
    const onDisk = new Set(files.map(({ file }) => file));
    for (const file of this.validated) {
      if (!onDisk.has(file)) this.validated.delete(file);
    }

    for (const { file } of files) {
      if (this.validated.has(file)) continue;
      try {
        if (await this.validate(file)) this.validated.add(file);
        else this.report(new Error(`No variables in ${file}`), this.model);
      } catch (error) {
        this.report(error, this.model);
      }
    }

    const db = this.cache.dbs[this.model];
    const scheduled = this.cache.lmdb.transactionSync(() => {
      const previous = state.get(this.model);
      // During a rolling restart, another writer may have published a fresher scan.
      if ((previous?.revision ?? 0) !== revision) return [];
      // A second process may have finished a purge since the directory was scanned.
      const present = files.filter(({ file }) => existsSync(file));
      const usable = present.filter(({ file, run }) => run <= now && this.validated.has(file));
      let activeRun = previous?.activeRun;
      for (const { run } of usable) {
        if (activeRun === undefined || run > activeRun) activeRun = run;
      }

      const selected = new Map();
      if (activeRun !== undefined) {
        const cutoff = activeRun - HISTORY_AGE;
        for (const candidate of usable) {
          if (candidate.valid < cutoff) continue;
          const current = selected.get(candidate.key);
          if (!current || candidate.run > current.run) selected.set(candidate.key, candidate);
        }
      }

      const current = new Map(Array.from(db.getRange(), ({ key, value }) => [key, value]));
      let pathsChanged = false;
      for (const key of current.keys()) {
        if (!selected.has(key)) {
          db.removeSync(key);
          pathsChanged = true;
        }
      }
      for (const [key, { file }] of selected) {
        if (current.get(key) !== file) {
          db.putSync(key, file);
          pathsChanged = true;
        }
      }

      const retained = new Set(Array.from(selected.values(), ({ file }) => file));
      const retired = {};
      for (const { file, run } of present) {
        if (retained.has(file) || (run > now && this.validated.has(file))) continue;
        retired[file] = previous?.retired[file] ?? now + FILE_GRACE;
      }

      if (!previous || pathsChanged || previous.activeRun !== activeRun ||
          Object.keys(previous.retired).length !== Object.keys(retired).length ||
          Object.entries(retired).some(([file, deadline]) => previous.retired[file] !== deadline)) {
        state.putSync(this.model, { revision: revision + 1, activeRun, retired });
      }
      return present.filter(({ file }) => retired[file] <= now);
    });

    if (!scheduled.length) return;
    this.cache.lmdb.transactionSync(() => {
      const published = state.get(this.model);
      for (const { key, file } of scheduled) {
        if (!(published.retired[file] <= now) || db.get(key) === file) continue;
        if (this.inFlight?.has(path.relative(path.resolve(this.root), file))) continue;
        try {
          unlinkSync(file);
          this.validated.delete(file);
          rmdirSync(path.dirname(file));
        } catch (error) {
          const code = error.code;
          if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') this.report(error, this.model);
        }
      }
    });
  }
}

function setupForecastHistory(orch, models, root, validate, report) {
  const enabled = Object.entries(models).filter(([, config]) =>
    config.enabled && config.managed !== false && config.fileExtension === '.om' && config.forecastHistory === true
  );
  if (!enabled.length) return undefined;

  const histories = new Map();
  const managed = new Set(enabled.map(([model]) => model));
  const updateIndex = orch.updateIndex.bind(orch);
  const cleanupModelFiles = orch.cleanupModelFiles.bind(orch);
  const processValidTime = orch.processValidTime.bind(orch);
  let timer;
  let pending;
  let stopped = false;
  let rerun = false;

  // PathCache is constructed and rebuilt inside start().
  // Skip its directory-based selection for rolling models, including on a rolling restart.
  const keepLegacyRebuild = (cache) => {
    const rebuild = cache.rebuild?.bind(cache);
    if (!rebuild) return;
    cache.rebuild = (config, fakeMode) => rebuild({
      ...config,
      models: Object.fromEntries(Object.entries(config.models).filter(([model]) => !managed.has(model)))
    }, fakeMode);
  };
  if (orch.pathCache) keepLegacyRebuild(orch.pathCache);
  else Object.defineProperty(orch, 'pathCache', {
    configurable: true,
    set(cache) {
      keepLegacyRebuild(cache);
      Object.defineProperty(orch, 'pathCache', { value: cache, configurable: true, writable: true, enumerable: true });
    }
  });

  const refresh = () => {
    if (stopped || !histories.size) return;
    if (pending) {
      rerun = true;
      return pending;
    }
    pending = (async () => {
      do {
        rerun = false;
        await Promise.all(Array.from(histories, async ([model, history]) => {
          try { await history.sync(); }
          catch (error) { report(error, model); }
        }));
      } while (rerun && !stopped);
    })().finally(() => { pending = undefined; });
    return pending;
  };

  orch.updateIndex = async (relativePath, localPath) => {
    if (managed.has(relativePath.split('/')[0])) void refresh();
    else await updateIndex(relativePath, localPath);
  };
  orch.cleanupModelFiles = async (model, cfg) => {
    if(!managed.has(model))return cleanupModelFiles(model,cfg);
    await orch.cleanupGribFiles?.(model,cfg);return 0;
  };
  orch.processValidTime = async (model, cfg, valid, run, priority) => {
    if (histories.get(model)?.shouldDownload(valid, run) === false) return false;
    return processValidTime(model, cfg, valid, run, priority);
  };

  return {
    async start() {
      if (stopped) return;
      const cache = orch.pathCache;
      if (!cache) throw new Error('LMDB is unavailable for forecast history');
      for (const [model] of enabled) {
        histories.set(model, new ForecastHistory(cache, root, model, validate, report, orch.inFlight));
      }
      timer = setInterval(refresh, SYNC_INTERVAL);
      timer.unref();
      await refresh();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      await pending;
    }
  };
}

module.exports = {ForecastHistory, setupForecastHistory};
