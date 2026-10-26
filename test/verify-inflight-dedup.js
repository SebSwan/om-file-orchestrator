// Vérifie qu'un fichier déjà en file ou en cours de téléchargement n'est pas ré-enfilé.
//
// Régression couverte : le check tourne chaque minute et processValidTime ne teste que le
// fichier final sur le disque ; un fichier long à télécharger était donc enfilé à chaque
// tick, les deux téléchargements écrivaient le même `.tmp` et le second échouait (ENOENT)
// après avoir consommé la bande passante (~13 % des téléchargements en production).

const fs = require("fs-extra");
const path = require("path");
const WeatherOrchestratorSimple = require("../WeatherOrchestratorSimple");
const baseConfig = require("../config.json");

const cacheDir = path.join("cache", "verify_inflight");
const config = {
    ...baseConfig,
    storage: { ...baseConfig.storage, cacheDir },
    logging: { ...baseConfig.logging, level: "error" }
};
const modelKey = "test_model";
const model = {
    name: "Test model",
    baseUrl: "https://example.invalid/data_spatial/test_model",
    fileExtension: ".om",
    enabled: true,
    retentionHours: 1
};

async function run() {
    console.log("🧪 enqueueDownload — un seul téléchargement par fichier");
    await fs.remove(cacheDir);

    // Mode fake : fakeDownloadFile écrit un .txt après 2 s, sans réseau. Pas de start()
    // (cron, LMDB) : seule la file est nécessaire.
    const orch = new WeatherOrchestratorSimple(config, { models: { [modelKey]: model } }, true);
    const { default: PQueue } = await import("p-queue");
    orch.downloadQueue = new PQueue({ concurrency: 4 });

    let echecs = 0;
    const check = (ok, msg) => { console.log(`${ok ? "✅" : "❌"} ${msg}`); if (!ok) echecs++; };

    // 1. Deux checks qui se recouvrent (tick suivant pendant le téléchargement) : un seul part.
    const args = [modelKey, model, "2020-12-15T12:00Z", "2020-12-15T12:00Z"];
    const [premier, second] = await Promise.all([
        orch.processValidTime(...args),
        orch.processValidTime(...args)
    ]);
    check(premier === true && second === false, `premier enfilé, second ignoré (${premier}, ${second})`);
    check(orch.stats.filesDownloaded === 1, `1 téléchargement effectué (${orch.stats.filesDownloaded})`);
    check(orch.inFlight.size === 0, "plus rien en vol une fois terminé");

    // 2. Le fichier existe désormais : ignoré par le test disque, pas par la garde.
    const troisieme = await orch.processValidTime(...args);
    check(troisieme === false, "fichier présent sur le disque : ignoré");

    // 3. Le chemin prioritaire partage la même garde.
    const relatif = `${modelKey}/2020/12/15/1200Z/2020-12-15T1300.om`;
    const [p1, p2] = await Promise.all([
        orch.processValidTime(modelKey, model, "2020-12-15T13:00Z", "2020-12-15T12:00Z"),
        orch.downloadWithPriority(relatif, 5)
    ]);
    check(p1 === true && p2 === false, `prioritaire ignoré quand le fichier est déjà en vol (${p1}, ${p2})`);

    // 4. Un échec libère la garde : le fichier peut être retenté au tick suivant.
    orch.fakeDownloadFile = async () => { throw new Error("réseau"); };
    await orch.processValidTime(modelKey, model, "2020-12-15T14:00Z", "2020-12-15T12:00Z").catch(() => {});
    check(orch.inFlight.size === 0, "échec de téléchargement : garde libérée");

    await fs.remove(cacheDir);
    orch.logger.close();
    if (echecs) { console.error(`❌ ${echecs} échec(s)`); process.exitCode = 1; }
    else console.log("🎉 OK");
}

run().catch((e) => { console.error("❌", e); process.exitCode = 1; });
