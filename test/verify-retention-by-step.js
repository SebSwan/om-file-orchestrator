// Vérifie que la purge porte sur l'ÉCHÉANCE des fichiers, pas sur leur mtime.
//
// Régression couverte : les fichiers partaient `retentionHours` après leur téléchargement.
// Les heures entre minuit et l'heure du run courant (absentes de ce run, servies par le
// précédent) disparaissaient donc quelques heures après leur arrivée : un trou en tête de
// série. Pire, une échéance FUTURE téléchargée longtemps avant était purgée si le run
// suivant tardait. Les versions remplacées par un run plus récent restent supprimées à
// l'indexation (`PathCache.set`) : il ne reste qu'un fichier par échéance.

const fs = require("fs-extra");
const path = require("path");
const WeatherOrchestratorSimple = require("../WeatherOrchestratorSimple");
const { isExpired } = WeatherOrchestratorSimple;
const PathCache = require("../path_cache");
const baseConfig = require("../config.json");

const cacheDir = path.join("cache", "verify_retention");
const config = {
    ...baseConfig,
    storage: { ...baseConfig.storage, cacheDir },
    logging: { ...baseConfig.logging, level: "error" },
    lmdb: { ...baseConfig.lmdb, path: path.join(cacheDir, "lmdb") }
};
const modelKey = "test_model";
const model = { name: "Test model", fileExtension: ".om", enabled: true, retentionHours: 6 };

const HOUR = 3600 * 1000;
const stepName = (ms) => {
    const iso = new Date(ms).toISOString();
    return iso.slice(0, 13) + iso.slice(14, 16);
};

async function run() {
    console.log("🧪 rétention par échéance");
    let echecs = 0;
    const check = (ok, msg) => { console.log(`${ok ? "✅" : "❌"} ${msg}`); if (!ok) echecs++; };

    // 1. Critère pur.
    const cutoffKey = "2026-11-18T0400";
    const cutoffTime = Date.parse("2026-11-18T04:00Z");
    const vieux = cutoffTime - 10 * HOUR;
    check(!isExpired("2026-11-18T0400.om", vieux, cutoffKey, cutoffTime), "échéance au seuil : gardée (borne exclusive)");
    check(isExpired("2026-11-18T0345.om", Date.now(), cutoffKey, cutoffTime), "échéance avant le seuil : purgée même téléchargée à l'instant");
    check(!isExpired("2026-11-20T1200.om", vieux, cutoffKey, cutoffTime), "échéance future téléchargée il y a longtemps : gardée");
    check(isExpired("notes.om", vieux, cutoffKey, cutoffTime), "nom hors format : repli sur la mtime");
    check(PathCache.retentionCutoffKey(6, Date.parse("2026-11-18T10:07Z")) === "2026-11-18T0407", "seuil au format des clés");

    // 2. Bout en bout : run 00Z (heures passées), run 06Z (présent et futur), tous vieux sur disque.
    await fs.remove(cacheDir);
    const orch = new WeatherOrchestratorSimple(config, { models: { [modelKey]: model } });
    const { default: PQueue } = await import("p-queue");
    orch.cleanupQueue = new PQueue({ concurrency: 8 });
    orch.pathCache = new PathCache(config, orch.logger);
    await orch.pathCache.init({ models: { [modelKey]: model } });

    const now = Date.now();
    const runDir = (name) => path.join(cacheDir, modelKey, "run", name);
    const fichiers = {
        trop_vieux: [runDir("00Z"), stepName(now - 8 * HOUR)],
        passe_utile: [runDir("00Z"), stepName(now - 3 * HOUR)],
        futur: [runDir("06Z"), stepName(now + 48 * HOUR)],
    };
    const ilYA12h = new Date(now - 12 * HOUR);
    for (const [dir, step] of Object.values(fichiers)) {
        const p = path.join(dir, `${step}.om`);
        await fs.outputFile(p, "");
        await fs.utimes(p, ilYA12h, ilYA12h); // tous téléchargés il y a 12 h > rétention
        await orch.pathCache.set(modelKey, step, p);
    }

    await orch.cleanupModelFiles(modelKey, model);
    await orch.cleanupQueue.onIdle();

    const etat = async (k) => {
        const [dir, step] = fichiers[k];
        return { fichier: await fs.pathExists(path.join(dir, `${step}.om`)), cle: !!orch.pathCache.get(modelKey, step) };
    };
    const tv = await etat("trop_vieux"), pu = await etat("passe_utile"), fu = await etat("futur");
    check(!tv.fichier && !tv.cle, `échéance hors fenêtre : fichier et clé purgés (${JSON.stringify(tv)})`);
    check(pu.fichier && pu.cle, `heure passée dans la fenêtre : gardée malgré sa mtime (${JSON.stringify(pu)})`);
    check(fu.fichier && fu.cle, `échéance future : gardée malgré sa mtime (${JSON.stringify(fu)})`);

    // 3. Un run plus récent qui couvre l'échéance remplace l'ancien fichier (un seul par échéance).
    const [, step] = fichiers.passe_utile;
    const nouveau = path.join(runDir("06Z"), `${step}.om`);
    await fs.outputFile(nouveau, "");
    await orch.pathCache.set(modelKey, step, nouveau);
    check(!(await fs.pathExists(path.join(fichiers.passe_utile[0], `${step}.om`))), "version remplacée supprimée à l'indexation");

    await orch.pathCache.close();
    await fs.remove(cacheDir);
    console.log(echecs === 0 ? "\n🎉 tout est vert" : `\n💥 ${echecs} échec(s)`);
    process.exitCode = echecs === 0 ? 0 : 1;
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
