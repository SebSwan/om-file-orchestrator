const PathCache = require("../path_cache");
const config = require("../config.json");
const modelConfig = require("./fixtures/model-config");
const fs = require("fs-extra");

// Mock Logger
const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg, err) => console.error(`[ERROR] ${msg}`, err),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`)
};

async function verifyRebuild() {
    console.log("🏗️ Testing LMDB Index Rebuild...");

    const dbPath = config.lmdb.path;

    // 1. DELETE LMDB to simulate fresh start (persistence loss)
    console.log(`💥 Deleting LMDB at ${dbPath}...`);
    await fs.remove(dbPath);
    await fs.ensureDir(dbPath);

    // 2. RUN Rebuild via PathCache
    console.log("🔄 Starting PathCache Rebuild...");
    const cache = new PathCache(config, logger);
    await cache.init(modelConfig);

    // Pass fakeMode=true because we saw .txt files in cache
    await cache.rebuild(modelConfig, true);

    // 3. VERIFY
    const modelKey = 'dwd_icon_d2';
    // We don't know exact keys, but we can count them
    let keyCount = 0;
    const db = cache.dbs[modelKey];

    if (db) {
        for (const { key } of db.getRange()) {
            keyCount++;
            // Optional: Log first few keys
            if (keyCount <= 3) {
                console.log(`   Found key: ${key}`);
            }
        }
    }

    if (keyCount > 0) {
        console.log(`✅ SUCCESS: Restored ${keyCount} keys for ${modelKey}.`);
    } else {
        console.warn(`⚠️ WARNING: No keys restored for ${modelKey}. Check if cache folder has files.`);
    }

    await cache.close();
}

verifyRebuild().catch(console.error);
