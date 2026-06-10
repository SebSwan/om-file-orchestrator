const { open } = require("lmdb");
const fs = require("fs-extra");
const path = require("path");

const RETENTION_HOURS_CACHE_LMDB = 24;

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
        this.lmdb = open({
            path: this.config.lmdb.path,
            compression: true,
            mapSize: this.config.lmdb.mapSize || 104857600,
            maxDbs: 60 // Allow for multiple model DBs (45+ models)
        });

        // Open named databases for each model
        this.dbs = {};
        for (const modelKey of Object.keys(modelConfigs.models)) {
            this.dbs[modelKey] = this.lmdb.openDB({
                name: modelKey
            });
        }
        this.logger.info("✅ LMDB initialized");
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

  async cleanup(modelKey, modelName) {
    if (!this.lmdb || !this.dbs[modelKey]) return 0;

    const retentionMs = RETENTION_HOURS_CACHE_LMDB * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;

    let deletedCount = 0;
    const db = this.dbs[modelKey];
    const keysToDelete = [];

      try {
        // 1. Collect keys to delete
        for (const { key } of db.getRange()) {
            try {
                // key format: 2025-12-14T2100
                // Simple date parsing
                const year = parseInt(key.substring(0, 4));
                const month = parseInt(key.substring(5, 7)) - 1;
                const day = parseInt(key.substring(8, 10));
                const hour = parseInt(key.substring(11, 13));
                const minute = parseInt(key.substring(13, 15));

                const keyDate = new Date(Date.UTC(year, month, day, hour, minute));

                if (keyDate.getTime() < cutoffTime) {
                    keysToDelete.push(key);
                } else {
                    break;
                }
            } catch (e) {
                this.logger.warn(`⚠️ Could not parse LMDB key for ${modelKey}: ${key}. Skipping.`);
                continue;
            }
        }

        // 2. Delete collected keys
        if (keysToDelete.length > 0) {
            this.logger.debug(`🗑️ Deleting ${keysToDelete.length} old LMDB keys for ${modelKey}...`);
            for (const key of keysToDelete) {
                 await db.remove(key);
                 deletedCount++;
                 this.logger.debug(`🗑️ Removed old LMDB key for ${modelKey}: ${key}`);
            }
            this.logger.info(`🧹 Cleaned ${deletedCount} LMDB keys for ${modelName}`);
        } else {
            this.logger.debug(`🗑️ No old LMDB keys to delete for ${modelKey}.`);
        }
      } catch (err) {
          this.logger.error(`❌ Error iterating/deleting keys for ${modelKey}:`, err.message);
      }
      return deletedCount;
  }

  /**
   * Supprime les clés LMDB dont le fichier n'existe plus sur le disque.
   * Nécessaire car la suppression des fichiers est basée sur le mtime (heure de
   * téléchargement) alors que cleanup() est basé sur le valid time de la clé :
   * un fichier meurt à mtime+retention, sa clé seulement à validtime+retention.
   * Sans cette réconciliation, l'index expose des clés mortes pendant des heures
   * (les consommateurs de getPath()/cache/all reçoivent alors des 502).
   */
  async sweepMissing(modelKey, modelName) {
    if (!this.lmdb || !this.dbs[modelKey]) return 0;

    const db = this.dbs[modelKey];
    const staleKeys = [];

    try {
      // 1. Collecter les clés mortes (ne pas muter pendant l'itération du range)
      for (const { key, value } of db.getRange()) {
        if (typeof value !== 'string' || value.length === 0) continue;
        if (!(await fs.pathExists(value))) {
          staleKeys.push(key);
        }
      }

      // 2. Supprimer
      for (const key of staleKeys) {
        await db.remove(key);
        this.logger.debug(`🗑️ Removed stale LMDB key (file missing) for ${modelKey}: ${key}`);
      }
      if (staleKeys.length > 0) {
        this.logger.info(`🧹 Removed ${staleKeys.length} stale LMDB keys (missing files) for ${modelName || modelKey}`);
      }
    } catch (err) {
      this.logger.error(`❌ Error sweeping stale keys for ${modelKey}:`, err.message);
    }
    return staleKeys.length;
  }

  async rebuild(modelConfigs, fakeMode = false) {
    if (!this.lmdb) return;

    this.logger.info("🏗️ Starting LMDB index rebuild...");
    let totalKeysRestored = 0;

    for (const [modelKey, model] of Object.entries(modelConfigs.models)) {
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
    this.logger.info(`✅ LMDB index rebuild completed. Total keys restored: ${totalKeysRestored}`);
  }

  async scanAndIndex(dirPath, modelKey, fakeMode) {
      let count = 0;
      const items = await fs.readdir(dirPath);

      for (const item of items) {
          const fullPath = path.join(dirPath, item);
          const stats = await fs.stat(fullPath);

          if (stats.isDirectory()) {
              count += await this.scanAndIndex(fullPath, modelKey, fakeMode);
          } else {
              // Check extension
              let isDataFile = item.endsWith('.om');
              if (fakeMode && item.endsWith('.txt')) {
                  isDataFile = true;
              }

              if (isDataFile) {
                  // Extract timestamp
                  const filename = item;
                  const extension = path.extname(filename);
                  const timestamp = filename.replace(extension, '');

                  const db = this.dbs[modelKey];
                  if (db) {
                      if (!db.get(timestamp)) {
                          await db.put(timestamp, fullPath);
                          count++;
                      }
                  }
              }
          }
      }
      return count;
  }
}

module.exports = PathCache;
