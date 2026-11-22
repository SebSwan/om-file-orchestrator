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

// Noms de variables partagés entre fichiers : ~2 000 fichiers × ~150 noms resteraient sinon
// autant de chaînes distinctes en mémoire.
const names = new Map();
const intern = (name) => names.get(name) ?? (names.set(name, name), name);

/**
 * Résultat de `validate(file)` : `true`/`false`, ou la liste des variables du fichier.
 * Liste vide = fichier invalide ; `true` = valide, variables inconnues (pas de repli possible).
 */
function variablesOf(result) {
  if (Array.isArray(result)) return result.length ? new Set(result.map(intern)) : false;
  return Boolean(result);
}

/** Le candidat porte-t-il une variable absente du fichier retenu ? */
function addsVariables(candidate, selected) {
  if (!(candidate instanceof Set) || !(selected instanceof Set)) return false;
  for (const name of candidate) if (!selected.has(name)) return true;
  return false;
}

class ForecastHistory {
  /** Fichier validé → variables (`Set`) ou `true` quand le validateur ne les donne pas. */
  validated = new Map();

  constructor(cache, root, model, validate, report, inFlight) {
    Object.assign(this, {cache, root, model, validate, report, inFlight});
    this.state = cache.lmdb.openDB({ name: 'forecast-history' });
    this.fallbacks = cache.lmdb.openDB({ name: `forecast-fallback:${model}` });
  }

  /**
   * Fichier d'un run plus ancien pour la même échéance, gardé tant que le fichier retenu n'a
   * pas toutes ses variables : fichier d'initialisation sans cumuls, run intermédiaire qui
   * publie moins de champs (IFS 06/18Z). `undefined` sans repli.
   */
  fallback(key) {
    return this.fallbacks.get(key);
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
    for (const file of this.validated.keys()) {
      if (!onDisk.has(file)) this.validated.delete(file);
    }

    for (const { file } of files) {
      if (this.validated.has(file)) continue;
      try {
        const variables = variablesOf(await this.validate(file));
        if (variables) this.validated.set(file, variables);
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
      const byKey = new Map();
      if (activeRun !== undefined) {
        const cutoff = activeRun - HISTORY_AGE;
        for (const candidate of usable) {
          if (candidate.valid < cutoff) continue;
          byKey.set(candidate.key, [...(byKey.get(candidate.key) ?? []), candidate]);
          const current = selected.get(candidate.key);
          if (!current || candidate.run > current.run) selected.set(candidate.key, candidate);
        }
      }

      // Repli : le run antérieur le plus récent qui apporte une variable absente du retenu.
      const fallback = new Map();
      for (const [key, chosen] of selected) {
        const older = (byKey.get(key) ?? []).filter(({ run }) => run < chosen.run).sort((a, b) => b.run - a.run);
        const found = older.find(({ file }) => addsVariables(this.validated.get(file), this.validated.get(chosen.file)));
        if (found) fallback.set(key, found);
      }
      for (const { key, value } of this.fallbacks.getRange()) {
        if (fallback.get(key)?.file !== value) this.fallbacks.removeSync(key);
      }
      for (const [key, { file }] of fallback) {
        if (this.fallbacks.get(key) !== file) this.fallbacks.putSync(key, file);
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

      const retained = new Set([...selected.values(), ...fallback.values()].map(({ file }) => file));
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
        if (!(published.retired[file] <= now) || db.get(key) === file || this.fallbacks.get(key) === file) continue;
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

/** Historique glissant pour tout modèle .om actif et géré ; `forecastHistory: false` le désactive. */
function usesForecastHistory(config) {
  return Boolean(config && config.enabled && config.managed !== false && config.fileExtension === '.om' && config.forecastHistory !== false);
}

function setupForecastHistory(orch, models, root, validate, report) {
  const managed = new Set(Object.keys(models).filter((model) => usesForecastHistory(models[model])));
  if (!managed.size) return undefined;

  const histories = new Map();
  const queuedModels = new Set();
  const updateIndex = orch.updateIndex.bind(orch);
  const cleanupModelFiles = orch.cleanupModelFiles.bind(orch);
  const processValidTime = orch.processValidTime.bind(orch);
  let timer;
  let pending;
  let stopped = false;

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

  const refresh = (models) => {
    if (stopped || !histories.size) return;
    for (const model of models) queuedModels.add(model);
    if (pending) return pending;

    // Regroupe les téléchargements d'un même modèle et borne le travail disque au démarrage.
    const batch = [...queuedModels];
    queuedModels.clear();
    pending = (async () => {
      for (const model of batch) {
        if (stopped) break;
        try { await histories.get(model).sync(); }
        catch (error) { report(error, model); }
      }
    })().finally(() => {
      pending = undefined;
      if (queuedModels.size) void refresh([]);
    });
    return pending;
  };

  orch.updateIndex = async (relativePath, localPath) => {
    const model = relativePath.split('/')[0];
    if (managed.has(model)) void refresh([model]);
    else await updateIndex(relativePath, localPath);
  };
  orch.cleanupModelFiles = async (model, cfg) => {
    if(!managed.has(model))return cleanupModelFiles(model,cfg);
    await orch.cleanupGribFiles?.(model,cfg);return 0;
  };
  // Fichier de repli d'une échéance (voir ForecastHistory.fallback), chemin tel qu'indexé.
  orch.getFallbackPath = (model, key) => histories.get(model)?.fallback(key);
  orch.processValidTime = async (model, cfg, valid, run, priority) => {
    if (histories.get(model)?.shouldDownload(valid, run) === false) return false;
    return processValidTime(model, cfg, valid, run, priority);
  };

  return {
    async start() {
      if (stopped) return;
      const cache = orch.pathCache;
      if (!cache) throw new Error('LMDB is unavailable for forecast history');
      for (const model of managed) {
        histories.set(model, new ForecastHistory(cache, root, model, validate, report, orch.inFlight));
      }
      await refresh(managed);
      if (!stopped) {
        timer = setInterval(() => void refresh(managed), SYNC_INTERVAL);
        timer.unref();
      }
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      await pending;
    }
  };
}

module.exports = {ForecastHistory, setupForecastHistory, usesForecastHistory};
