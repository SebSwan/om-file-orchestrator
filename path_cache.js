const { open } = require("lmdb");
const fs = require("fs-extra");
const path = require("path");

class PathCache {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.lmdb = null;
    this.dbs = {};
  }

  async init(modelConfigs) {
    if (!this.config.lmdb) return;

    this.logger.info("📦 Initializing LMDB...");
    try {
        // Only open a database for models that are actually enabled.
        // LMDB caps the number of open named databases (maxDbs); opening one per entry in
        // the config file made that cap depend on the SIZE OF THE CONFIG rather than on
        // what the orchestrator actually uses. A consumer listing 61 models but enabling 22
        // hit MDB_DBS_FULL at startup, which leaves the cache empty and silently breaks
        // every lookup. Models without an explicit `enabled` flag stay enabled (backwards
        // compatible with configs predating the flag).
        const modelKeys = Object.keys(modelConfigs.models).filter(
            (key) => modelConfigs.models[key].enabled !== false
        );

        this.lmdb = open({
            path: this.config.lmdb.path,
            compression: true,
            mapSize: this.config.lmdb.mapSize || 104857600,
            // Headroom above what we open, overridable by the consumer.
            maxDbs: this.config.lmdb.maxDbs || Math.max(60, modelKeys.length * 2)
        });

        // Open named databases for each enabled model
        this.dbs = {};
        for (const modelKey of modelKeys) {
            this.dbs[modelKey] = this.lmdb.openDB({
                name: modelKey
            });
        }
        this.logger.info(`✅ LMDB initialized (${modelKeys.length} model DBs)`);
    } catch (err) {
        this.logger.error("❌ Failed to initialize LMDB:", err);
        throw err;
    }
  }

  async close() {
    if (this.lmdb) {
        await this.lmdb.close();
        this.logger.info("db LMDB closed");
        this.lmdb = null;
        this.dbs = {};
    }
  }

  get(modelKey, timestamp) {
    if (!this.lmdb || !this.dbs[modelKey]) return null;
    return this.dbs[modelKey].get(timestamp);
  }

  async set(modelKey, timestamp, fullPath) {
    if (!this.lmdb || !this.dbs[modelKey]) return;

    const db = this.dbs[modelKey];
    try {
        // 1. Get old path
        const oldPath = db.get(timestamp);

        // 2. Put new path
        await db.put(timestamp, fullPath);
        this.logger.debug(`LMDB updated for model: ${modelKey}, key: ${timestamp}`);

        // 3. Delete old file if different and exists
        if (oldPath && oldPath !== fullPath) {
            try {
                if(await fs.pathExists(oldPath)) {
                   await fs.remove(oldPath);
                   this.logger.info(`🗑️ Deleted old version: ${oldPath}`);
                }
            } catch (delError) {
                this.logger.warn(`⚠️ Failed to delete old file ${oldPath}: ${delError.message}`);
            }
        }
        return true;
    } catch (err) {
        this.logger.error(`❌ LMDB update failed: ${err.message}`);
        return false;
    }
  }

  /**
   * Retire la clé `timestamp` SI elle désigne encore `filePath` — appelé juste après la
   * suppression du fichier, pour que l'index ne survive jamais à ce qu'il référence.
   * La garde sur le chemin évite d'effacer une clé repointée sur un run plus récent.
   */
  async dropKeyForFile(modelKey, timestamp, filePath) {
    const db = this.dbs[modelKey];
    if (!db || db.get(timestamp) !== filePath) return false;
    await db.remove(timestamp);
    return true;
  }

  /**
   * Supprime les clés dont l'ÉCHÉANCE est plus vieille que `retentionHours`.
   * (La purge des fichiers, elle, se base sur leur mtime — voir cleanupModelFiles.)
   */
  async cleanup(modelKey, modelName, retentionHours) {
    if (!this.lmdb || !this.dbs[modelKey]) return 0;

    const db = this.dbs[modelKey];
    // Les clés sont des `YYYY-MM-DDTHHMM` de largeur fixe : leur ordre lexicographique
    // est chronologique, donc le cutoff formaté pareil borne le curseur nativement.
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
    const cutoffKey = cutoff.slice(0, 13) + cutoff.slice(14, 16);

    try {
      const keysToDelete = [...db.getKeys({ end: cutoffKey })];
      if (keysToDelete.length === 0) {
        this.logger.debug(`🗑️ No old LMDB keys to delete for ${modelKey}.`);
        return 0;
      }
      this.logger.debug(`🗑️ Deleting ${keysToDelete.length} old LMDB keys for ${modelKey}...`);
      // Sans `await` par clé, lmdb-js regroupe le tout dans une seule transaction.
      let last;
      for (const key of keysToDelete) last = db.remove(key);
      await last;
      this.logger.info(`🧹 Cleaned ${keysToDelete.length} LMDB keys for ${modelName}`);
      return keysToDelete.length;
    } catch (err) {
      this.logger.error(`❌ Error iterating/deleting keys for ${modelKey}:`, err.message);
      return 0;
    }
  }

  async rebuild(modelConfigs, fakeMode = false) {
    if (!this.lmdb) return;

    this.logger.info("🏗️ Starting LMDB index rebuild...");
    let totalKeysRestored = 0;

    for (const [modelKey, model] of Object.entries(modelConfigs.models)) {
        // `init()` n'ouvre une base que pour les modèles activés : sans elle, scanAndIndex
        // parcourrait l'arborescence pour jeter le résultat.
        if (!this.dbs[modelKey]) continue;
        const modelDir = path.join(this.config.storage.cacheDir, modelKey);
        if (await fs.pathExists(modelDir)) {
             try {
                 const count = await this.scanAndIndex(modelDir, modelKey, fakeMode);
                 if (count > 0) {
                     this.logger.info(`🏗️ Restored ${count} keys for ${model.name}`);
                     totalKeysRestored += count;
                 }
             } catch (err) {
                 this.logger.error(`❌ Error rebuilding index for ${model.name}:`, err.message);
             }
        }
    }
    const orphans = await this.pruneMissingFiles();
    this.logger.info(
      `✅ LMDB index rebuild completed. Total keys restored: ${totalKeysRestored}`
      + (orphans ? `, ${orphans} orphan keys dropped` : "")
    );
  }

  /**
   * Retire les clés dont le fichier n'existe plus. Sans ça, un fichier purgé sur sa mtime
   * laisse une entrée d'index que le consommateur résout en chemin mort.
   */
  async pruneMissingFiles() {
    let dropped = 0;
    for (const [modelKey, db] of Object.entries(this.dbs)) {
      const morts = [];
      for (const { key, value } of db.getRange()) {
        if (!(await fs.pathExists(value))) morts.push(key);
      }
      let last;
      for (const key of morts) last = db.remove(key);
      if (last) await last;
      if (morts.length) {
        this.logger.info(`🧹 Dropped ${morts.length} orphan LMDB keys for ${modelKey}`);
        dropped += morts.length;
      }
    }
    return dropped;
  }

  async scanAndIndex(dirPath, modelKey, fakeMode) {
      let count = 0;
      // withFileTypes : le type d'entrée est gratuit, un fs.stat par fichier ne l'est pas
      // (et l'ancienneté ne sert pas ici, contrairement à la purge).
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      const db = this.dbs[modelKey];
      let last;

      for (const item of items) {
          const fullPath = path.join(dirPath, item.name);

          if (item.isDirectory()) {
              count += await this.scanAndIndex(fullPath, modelKey, fakeMode);
              continue;
          }
          const isDataFile = item.name.endsWith('.om') || (fakeMode && item.name.endsWith('.txt'));
          if (!isDataFile || !db) continue;

          // Clé = nom de fichier sans extension (ex. 2025-12-14T2100)
          const timestamp = item.name.replace(path.extname(item.name), '');
          if (!db.get(timestamp)) {
              last = db.put(timestamp, fullPath); // groupé en une transaction, cf. cleanup
              count++;
          }
      }
      if (last) await last;
      return count;
  }
}

module.exports = PathCache;
