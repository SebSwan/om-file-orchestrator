# Lancement du pilote avec un catalogue unique

Les modèles sont définis uniquement dans le `src/config/config_model.json` du serveur. Le fichier `indian-ocean-pilot.json` ne contient plus de définitions de modèle : il référence ce catalogue avec `modelConfigFile` et sélectionne l’entrée `meteofrance_arome_indian_ocean_native` pour ce worker. L’activation reste celle du catalogue.

Le montage Compose nécessite `OM_MODEL_CONFIG_FILE`, chemin hôte vers ce fichier. Le catalogue est monté en lecture seule sous `/app/config/config_model.json`. Aucun téléchargement, build ou déploiement n’est déclenché par cette configuration.

La sélection de 30 variables, les 11 paquets, l’horizon +48 h, les budgets de conversion, la rétention GRIB et le dossier d’acquisition sont dans l’entrée du modèle. Le fichier du pilote conserve seulement sa file commune, la racine OM/LMDB, ses logs et son port de monitoring. Le conteneur conserve les limites proposées de 2 CPU et 4 Gio. Le modèle reste désactivé.

Pour inspecter localement sans données :

```sh
node lib/config-cli.js examples/meteofrance/indian-ocean-pilot.json --models /chemin/tile-server-om/src/config/config_model.json
```

Le détail documentaire des paquets est dans `indian-ocean-30-variables.json`, qui ne contient plus de sélection exécutable. La liste des variables à produire est uniquement dans le catalogue canonique. Le profil du convertisseur décrit les champs décodables, pas le choix d’output.

Le premier run réel confirmera les sélecteurs GRIB, unités et échéances. Le worker attend la disponibilité de tous les paquets avant conversion et publie ensuite le run validé. `/metrics` et `/status` permettent le suivi ; les OM visibles en staging ne sont pas encore publiés.

Le fragment Prometheus et le dashboard du serveur sont à raccorder manuellement au lancement du test live. Le worker isolé utilise une racine OM dédiée ; rendre ses données accessibles aux endpoints du produit reste une étape distincte.

Voir [MODEL_CONFIGURATION.md](../../MODEL_CONFIGURATION.md) pour le contrat partagé et [METEOFRANCE_OVH.md](METEOFRANCE_OVH.md) pour le catalogue documentaire des chemins.
