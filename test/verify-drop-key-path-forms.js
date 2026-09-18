// Vérifie que dropKeyForFile reconnaît un même fichier écrit sous deux formes de chemin.
//
// Régression couverte : l'orchestrateur indexe `path.join(cacheDir, …)` alors qu'une
// ingestion externe (modèle `managed: false`) peut indexer en absolu. Avec un `cacheDir`
// relatif, la comparaison de chaînes échouait toujours — le cleanup supprimait le fichier
// et laissait la clé, qui désignait alors un absent jusqu'au prochain rebuild.

const path = require("path");
const PathCache = require("../path_cache");
const config = require("../config.json");
const modelConfig = require("../config_model.json");

const logger = {
    info: () => {},
    error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ""),
    warn: () => {},
    debug: () => {}
};

async function run() {
    console.log("🧪 dropKeyForFile — formes de chemin équivalentes");

    const cache = new PathCache(config, logger);
    await cache.init(modelConfig);

    const modelKey = Object.keys(cache.dbs)[0];
    if (!modelKey) {
        console.error("❌ aucune base LMDB ouverte — config_model.json n'active aucun modèle");
        process.exitCode = 1;
        return;
    }

    const relatif = path.join("cache", "verify_drop_key", "2020-12-15T1200.om");
    const absolu = path.resolve(relatif);
    let echecs = 0;

    // 1. Indexé en ABSOLU (ingestion externe), supprimé en RELATIF (cleanup) : la clé doit partir.
    await cache.set(modelKey, "2020-12-15T1200", absolu);
    const drop = await cache.dropKeyForFile(modelKey, "2020-12-15T1200", relatif);
    if (drop && !cache.get(modelKey, "2020-12-15T1200")) {
        console.log("✅ absolu indexé / relatif supprimé : clé retirée");
    } else {
        console.error(`❌ clé conservée alors que le fichier est supprimé (retour ${drop})`);
        echecs++;
    }

    // 2. Symétrique : indexé en RELATIF, supprimé en ABSOLU.
    await cache.set(modelKey, "2020-12-15T1300", relatif);
    const dropSym = await cache.dropKeyForFile(modelKey, "2020-12-15T1300", absolu);
    if (dropSym && !cache.get(modelKey, "2020-12-15T1300")) {
        console.log("✅ relatif indexé / absolu supprimé : clé retirée");
    } else {
        console.error(`❌ clé conservée dans le sens symétrique (retour ${dropSym})`);
        echecs++;
    }

    // 3. Garde-fou préservé : la clé repointée sur un AUTRE fichier (run plus récent)
    //    ne doit pas être effacée par la suppression de l'ancien.
    const autre = path.resolve("cache", "verify_drop_key", "autre_run.om");
    await cache.set(modelKey, "2020-12-15T1400", autre);
    const dropAutre = await cache.dropKeyForFile(modelKey, "2020-12-15T1400", relatif);
    if (!dropAutre && cache.get(modelKey, "2020-12-15T1400") === autre) {
        console.log("✅ clé repointée sur un autre fichier : conservée");
    } else {
        console.error(`❌ garde-fou perdu : une clé valide a été effacée (retour ${dropAutre})`);
        echecs++;
    }

    await cache.dropKeyForFile(modelKey, "2020-12-15T1400", autre); // ne rien laisser derrière
    await cache.close();

    console.log(echecs === 0 ? "\n🎉 3/3" : `\n💥 ${echecs} échec(s)`);
    process.exitCode = echecs === 0 ? 0 : 1;
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
