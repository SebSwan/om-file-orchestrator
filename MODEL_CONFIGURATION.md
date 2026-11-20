# Catalogue unique des modèles

L'application possède un seul `config_model.json`. La bibliothèque n'embarque plus de catalogue de secours et ne crée plus de modèles activés par défaut.

Dans tile-server-om, le fichier de référence est `src/config/config_model.json` ; Docker en copie cette version sous `/app/config/config_model.json`. Le développement lit le même fichier. L'ancien nom `config_model.dev.json` est un lien de compatibilité vers lui.

Chaque entrée `models.<id>` contient l'activation (`enabled`), la gestion (`managed`), la source, la fréquence de contrôle, la rétention et l'historique. Les sources OM utilisent `baseUrl`, `statusFile` et `fileExtension`. Leur horizon facultatif est `maxForecastHour`, y compris fractionnaire pour les pas de 15 minutes. Les sources GRIB utilisent `ingestion.provider`, `domain`, `packages`, `maxForecastHour`, `variables`, le dossier GRIB et les budgets. Les variables du profil du convertisseur décrivent les possibilités de décodage ; elles ne sélectionnent pas les variables produites.

Les réglages du processus (queue commune, racine OM/LMDB, logs, limites du conteneur et port de monitoring) restent dans sa configuration d'exécution. Celle-ci peut référencer le catalogue via `modelConfigFile`, sans contenir de bloc `models`. Les blocs concurrents sont refusés. Une référence relative est résolue depuis le fichier qui la contient. Le chemin peut également être fourni avec `--models`.

```js
const {loadConfigurations,createOrchestrator}=require('om-file-orchestrator');
const {config,modelConfig}=loadConfigurations('/path/config.json','/path/config_model.json');
const orchestrator=createOrchestrator(config,modelConfig);
```

Le worker du pilote référence `/app/config/config_model.json` et `modelKeys` indique seulement quelles entrées il prend en charge. Il ne modifie jamais `enabled`. Le Compose monte le catalogue en lecture seule avec `OM_MODEL_CONFIG_FILE` (chemin hôte à renseigner). Le worker général Météo-France peut utiliser `modelProvider: meteofrance-grib` pour référencer toutes les entrées de ce fournisseur.

```sh
node lib/config-cli.js examples/meteofrance/indian-ocean-pilot.json --models /path/config_model.json
node lib/worker.js examples/meteofrance/indian-ocean-pilot.json
```

La première commande inspecte seulement. La seconde lance réellement le worker et suppose que sa référence au catalogue est accessible ; ne la lancer qu'au moment choisi. Le serveur, le worker et l'inspection utilisent le même lecteur de catalogue. Les changements sont lus au démarrage ; aucun rechargement automatique n'est introduit.

`config.orchestrator.models` et `OM_MAX_FORECAST_HOURS` ne pilotent plus l'activation/horizon : modifier `config_model.json`. Le serveur refuse l'ancien réglage d'horizon pour éviter de télécharger un run entier alors qu'un ancien lancement croyait encore le limiter. Le helper RRFS exige que le modèle choisi soit le seul activé pour le téléchargement et possède un horizon dans le catalogue.

Les fichiers `*.catalogue.json`, inventaires et documents de provenance sont informatifs. Ils ne sont jamais utilisés comme configuration d'exécution. Le générateur OVH ne réécrit plus de modèles ou de sélections actives.

La consolidation conserve les activations du catalogue de production existant. Les modèles Météo-France natifs restent désactivés, y compris l'océan Indien avec sa sélection de 30 variables, ses 11 paquets et son horizon +48 h. Aucun téléchargement ni service n'est déclenché par la migration.
