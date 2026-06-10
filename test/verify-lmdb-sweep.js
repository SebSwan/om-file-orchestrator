const PathCache = require("../path_cache");
const modelConfig = require("../config_model.json");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

// Mock Logger
const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg, err) => console.error(`[ERROR] ${msg}`, err),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`)
};

async function verifySweep() {
    console.log("🧪 Testing sweepMissing (réconciliation index ↔ disque)...");

    // LMDB isolé dans un dossier temporaire (ne pas toucher au cache réel)
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lmdb-sweep-"));
    const config = { lmdb: { path: path.join(tmpDir, "lmdb") } };

    const cache = new PathCache(config, logger);
    await cache.init(modelConfig);

    const modelKey = "dwd_icon_d2";
    let failed = false;

    try {
        // 1. Une clé dont le fichier EXISTE
        const alivePath = path.join(tmpDir, "alive.om");
        await fs.writeFile(alivePath, "x");
        await cache.set(modelKey, "2026-06-10T1200", alivePath);

        // 2. Une clé dont le fichier N'EXISTE PAS (simule la purge mtime-based)
        await cache.set(modelKey, "2026-06-09T1700", path.join(tmpDir, "missing.om"));

        // 3. Sweep
        const removed = await cache.sweepMissing(modelKey, "Test Model");

        // 4. Assertions
        const aliveStill = cache.get(modelKey, "2026-06-10T1200");
        const deadGone = cache.get(modelKey, "2026-06-09T1700");

        if (removed !== 1) { console.error(`❌ removed=${removed}, attendu 1`); failed = true; }
        if (aliveStill !== alivePath) { console.error(`❌ la clé vivante a été perdue`); failed = true; }
        if (deadGone !== undefined && deadGone !== null) { console.error(`❌ la clé morte est toujours là: ${deadGone}`); failed = true; }

        // 5. Idempotence : second sweep = 0 suppression
        const removedAgain = await cache.sweepMissing(modelKey, "Test Model");
        if (removedAgain !== 0) { console.error(`❌ second sweep removed=${removedAgain}, attendu 0`); failed = true; }

        if (!failed) console.log("✅ sweepMissing OK : clé morte purgée, clé vivante conservée, idempotent");
    } finally {
        await cache.close();
        await fs.remove(tmpDir);
    }

    if (failed) process.exit(1);
}

verifySweep().catch((e) => { console.error("❌ Test crashed:", e); process.exit(1); });
