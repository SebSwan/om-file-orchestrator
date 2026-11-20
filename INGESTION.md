La configuration de référence est désormais décrite dans [MODEL_CONFIGURATION.md](MODEL_CONFIGURATION.md). Les fichiers de lancement référencent le catalogue unique ; ils ne contiennent plus de modèles.

# Orchestration OM et GRIB

Une seule instance `createOrchestrator` gère les sources OM existantes et les sources GRIB. Node >= 18.18 ; aucun héritage applicatif.

```js
const {createOrchestrator, IngestionTelemetry} = require('om-file-orchestrator');
const {createGribConverter} = await import('@spotsguru/om-file-ingestion');
const orchestrator = createOrchestrator(config, {models});
orchestrator.registerConverter('grib-to-om', createGribConverter());
const telemetry = new IngestionTelemetry(promClient, registry);
orchestrator.onIngestionEvent(event => telemetry.event(event));
// start() uniquement au lancement manuel souhaité.
```

Cette bibliothèque ne décode pas les GRIB : elle injecte le convertisseur séparé. `registerSource(name, {discover, sourceLayout})` ajoute des catalogues. `discover` retourne `{referenceTime, files:[{name,url,bytes,etag}], missing, validTimes}` ; `sourceLayout` retourne notamment `dimensions`.

Configuration par modèle : `ingestion.provider`, `domain`, `packages`, `maxForecastHour`, **`variables` explicites**, `rulesFile`, `workDirectory`, `gribRetentionHours`, `downloadConcurrency`, `downloadTimeoutMs`, `resources`, `engine`, `unknownFields`. `converter` vaut `grib-to-om` par défaut. Sans `ingestion.provider`, le téléchargement OM historique s'applique. Les variables sont vérifiées dans le profil avant toute requête réseau. Les exemples dans `examples/meteofrance/` restent désactivés.

`config.ingestion.maxRuns` borne les traitements admis ; `preparationConcurrency` borne les préparations. La file `config.queue` est partagée entre téléchargements OM et GRIB. `downloadConcurrency` limite chaque modèle GRIB. Une seule conversion est active ; un autre modèle peut télécharger pendant celle-ci. Les contrôles simultanés du même modèle partagent le traitement actif. Une file pleine diffère le travail au prochain contrôle périodique.

Tous les paquets configurés sont attendus avant conversion. Les GRIB sont validés (taille, signature, SHA-256) et conservés pour les reprises. Le staging est sur le volume des OM. Le convertisseur retourne un OM spatial avec les variables sélectionnées pour chaque échéance. Le run complet est validé puis publié par renommage et indexé. Une panne d'indexation reprend sans reconversion. Une sélection modifiée sur un run déjà publié nécessite un autre identifiant de modèle.

Disque et mémoire sont vérifiés avant acquisition/conversion, y compris cgroup v2. Les budgets sont des conditions d'admission, pas des limites système : les limites CPU/RAM doivent être appliquées au processus ou au conteneur. `node lib/worker.js config.json` fournit `/metrics` et `/status`, requiert `prom-client` et le convertisseur installés par l'application, et exige par défaut des limites cgroup. Rien ne le lance automatiquement.

La purge OM conserve le critère existant d'échéance valide. La purge GRIB est indépendante et conserve les échecs/verrous. `ForecastHistory` et `setupForecastHistory` portent aussi la sélection des runs et l'historique : le serveur fournit uniquement son contrôle de lecture OM. La politique existante (36 heures avant le run actif, remplacement par échéance et délai de suppression) est conservée.

Adaptateurs : AROME France 0.025, AROME HD, ARPEGE Europe, AROME océan Indien. Les autres chemins du catalogue OVH sont préparatoires et nécessitent encore un adaptateur et une validation de grille. L'accès au dépôt public n'utilise pas de clé API.

Tests hors ligne : `npm run test:ingestion`, `npm run test:paths`, `npm run test:inflight`, `node test/verify-retention-by-step.js`. Les réponses HTTP et le convertisseur sont simulés ; ces tests ne valident pas le codec natif.

## Préparation hors ligne et tests

`npm run test:offline` exécute les 48 tests d'ingestion/historique et les régressions de rétention, chemins LMDB et déduplication. Les appels HTTP et le moteur sont simulés ; une intégration utilise réellement LMDB et la file partagée.

```sh
node lib/config-cli.js examples/meteofrance/indian-ocean-pilot.json
node lib/config-cli.js /chemin/config.json --models /chemin/config_model.json --model meteofrance_arome_indian_ocean_native
```

La commande n'accède ni au réseau ni aux GRIB, ne crée pas les dossiers cibles et ne lance pas le moteur. Le code de sortie 0 indique que les modèles activés passent les contrôles ; 1 indique une configuration active invalide ; 2 une erreur de lecture/arguments. Chaque entrée expose séparément `enabled`, `ready`, `errors` et `warnings` : une préparation inactive peut rester incomplète sans invalider les sources actives.

`--check-profile` vérifie aussi les noms des variables avec le package d'ingestion installé/compilé, sans lancer Rust. `--profile /chemin/profil.json` choisit un profil spécifique. Sans cette option, les noms sont seulement vérifiés syntaxiquement et cette limite figure dans les avertissements.

L'API publique `inspectIngestionConfiguration(config, models, {rules, sources})` fournit le même rapport au serveur, qui refuse la configuration GRIB active invalide avant de démarrer les planificateurs.

Le fragment `examples/meteofrance/prometheus-job.example.yml` est à ajouter manuellement au Prometheus du réseau monitoring lors du test live. Le dashboard versionné du serveur, `config/grafana/dashboards/ingestion.json`, suit la phase, les files, le débit, CPU/RAM, les durées, les erreurs et les OM visibles par rapport aux sorties attendues. La visibilité en staging ne signifie pas encore publication.
