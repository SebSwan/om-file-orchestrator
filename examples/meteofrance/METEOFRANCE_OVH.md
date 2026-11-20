# Chemins Météo-France sur OVH — préparation inactive

Les fichiers ci-dessous ne lancent aucun téléchargement. Tous les nouveaux modèles sont `enabled: false` et ont `variables: []`. Les configurations des modèles déjà existants ne sont pas désactivées ni remplacées.

## Où modifier

- `meteofrance-ovh.json` : configuration complète autonome, avec stockage proposé sous `/var/data/meteofrance` ; tous les modèles sont désactivés.
- `meteofrance-ovh.catalogue.json` : catalogue des chemins, modèles de noms de fichiers, paquets et échéances observées.
- `../../../src/config/config_model.json` et `../../../src/config/config_model.dev.json` : les mêmes nouvelles entrées natives ont été ajoutées désactivées pour le futur déploiement manuel du serveur. Leurs identifiants finissent par `_native` afin de ne pas remplacer les sources OM existantes.
- `catalogue/ovh-evidence-20261119.json` : éléments de vérification du catalogue : run, exemples, nombre d'objets et tailles.
- `catalogue/ovh-families-20261119.json` : familles observées sur sept runs du 19 novembre.

La vérification porte uniquement sur des métadonnées publiques du bucket `meteofrance-pnt`, préfixe `pnt/`. Aucun GRIB ou NetCDF n'a été téléchargé. Aucun accès au serveur de production ni compilation n'a été effectué pour cette préparation.

## Routes observées

Chaque préfixe ci-dessous est placé après `pnt/{referenceTime}/` sur `https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/`.

| Domaine ou produit | Préfixe |
| --- | --- |
| AROME France 0,01° | `arome/001/` |
| AROME France 0,025° | `arome/0025/` |
| AROME-IFS France 0,025° | `aromeifs/0025/` |
| AROME Antilles | `arome-om/ANTIL/0025/` |
| AROME Guyane | `arome-om/GUYANE/0025/` |
| AROME océan Indien | `arome-om/INDIEN/0025/` |
| AROME Nouvelle-Calédonie | `arome-om/NCALED/0025/` |
| AROME Polynésie | `arome-om/POLYN/0025/` |
| ARPEGE Europe 0,1° | `arpege/01/` |
| ARPEGE monde 0,25° | `arpege/025/` |
| MFWAM | `vague-surcote/MFWAM/0025/`, `vague-surcote/MFWAM/01/` |
| HYCOM2D | `vague-surcote/HYCOM2D-{MARO,MARP,WARO,WARP}/004/` |
| WW3, fichiers NetCDF | `vague-surcote/WW3-{MARO,MARP,WARP}/001/` |
| Produits complémentaires PHEALTH / UVQ | `phealth/{CARAIB0025,EURW1S40,GLOBE025,GUYANE0025,INDIEN0025,NCALED0025,POLYN0025}/` |

Les accolades dans cette table abrègent plusieurs chemins : le catalogue JSON contient un enregistrement distinct et explicite pour chacune des 26 routes. Ses modèles de noms de fichiers ont été confrontés à tous les objets du run inspecté du 19 novembre à 12 UTC.

La présence d'un objet ne garantit ni la complétude du run, ni la disponibilité future à ce même emplacement daté. Les chemins configurés utilisent `{referenceTime}`, pas cette date fixe. Les échéances observées sont documentaires : elles doivent être recontrôlées à l'activation, notamment pour les fichiers marins multi-échéances et les produits dépendant du run.

## AROME PI et autres réservations

AROME PI n'a pas été trouvé dans les familles publiées sur les sept runs inspectés. Deux entrées sont réservées pour ses résolutions 0,025° et 0,01°, mais leurs adresses OVH sont `null`. PIAF, AROME ensemble et ARPEGE ensemble sont également réservés sans adresse OVH confirmée.

Cela ne prouve pas qu'ils n'existent sur aucun autre service ou stockage. Leur disponibilité via les API de Météo-France n'est pas une preuve de présence dans ce bucket. Aucun préfixe n'a été inventé, et aucun basculement vers une API authentifiée n'est configuré.

## Un chemin configuré n'est pas encore une ingestion validée

Le champ `_preparation` de chaque modèle indique son statut. Ce champ est documentaire, il n'est pas un paramètre reconnu par l'adaptateur de téléchargement.

| Statut | État |
| --- | --- |
| `adapter-present` | Source reconnue par le code du worktree : AROME France, HD, océan Indien et ARPEGE Europe. Qualification réelle à compléter selon le domaine. |
| `adapter-required` | Adresse et nommage renseignés ; extension de l'adaptateur et validation du domaine encore nécessaires. |
| `longitude-rotation-required` | ARPEGE global : la gestion des longitudes de cette grille n'est pas prise en charge par le moteur actuel. |
| `netcdf-reader-required` | Les WW3 concernés sont des NetCDF ; ils ne peuvent pas être envoyés au lecteur GRIB. |
| `ovh-path-not-found` | Adresse non confirmée ; entrée réservée uniquement. |

Ainsi, les routes Antilles/Guyane/Nouvelle-Calédonie/Polynésie sont préparées, mais ne deviennent pas exécutables par la seule modification de `enabled`. Il faudra compléter la déclaration des domaines et leurs contrôles de grille après validation de l'océan Indien. Le moteur actuel conserve une liste explicite de domaines pris en charge ; les autres échouent avant acquisition si on tente de les activer.

## Avant une activation manuelle

Choisir les variables ; vérifier les paquets correspondants et les coordonnées de grille ; compléter l'adaptateur si nécessaire ; qualifier les transformations et unités ; régler les budgets et les rétentions ; puis seulement activer l'entrée choisie. Une liste `variables` vide reste bloquante dans le workflow actif.

La source publique du diffuseur a servi de référence complémentaire pour les conventions : https://github.com/datagouv/mf-data-extract-service. Elle ne remplace pas les observations du catalogue courant. Les anciennes conventions peuvent évoluer.
