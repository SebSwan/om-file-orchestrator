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
