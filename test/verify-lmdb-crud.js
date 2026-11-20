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

async function verifyCrud() {
    console.log("🧪 Testing LMDB CRUD operations...");

    const cache = new PathCache(config, logger);
    await cache.init(modelConfig);

    const modelKey = 'dwd_icon_d2';
    // Use an OLD timestamp to verify cleanup (older than 24h)
    // Format must match what system uses: YYYY-MM-DDTHHmm
    const oldTimestamp = "2020-12-15T1200";
    const fakePath = "/tmp/fake_weather_file.om";

    // 1. SET
    console.log(`\n➡️  SET key: ${oldTimestamp}`);
    await cache.set(modelKey, oldTimestamp, fakePath);

    // 2. GET
    const retrievedPath = cache.get(modelKey, oldTimestamp);
    console.log(`⬅️  GET key: ${oldTimestamp} => ${retrievedPath}`);

    if (retrievedPath === fakePath) {
        console.log("✅ SET/GET verification passed.");
    } else {
        console.error("❌ SET/GET verification failed!");
    }

    // 3. CLEANUP
    console.log("\n🧹 Running Cleanup (Retention is 24h)...");
    // Since timestamp is from 2020, it should be deleted.
    const deletedCount = await cache.cleanup(modelKey, "DWD ICON D2");

    // 4. VERIFY DELETION
    const afterCleanup = cache.get(modelKey, oldTimestamp);
    if (!afterCleanup && deletedCount > 0) {
        console.log("✅ Cleanup verification passed: Key was removed.");
    } else {
        console.error(`❌ Cleanup verification failed. Key exists: ${!!afterCleanup}, Deleted count: ${deletedCount}`);
    }

    await cache.close();
}

verifyCrud().catch(console.error);
