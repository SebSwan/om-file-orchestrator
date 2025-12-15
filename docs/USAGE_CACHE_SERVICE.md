# Utilisation du Cache LMDB dans un Service Externe

Ce document explique comment activer et utiliser le cache LMDB de `om-file-orchestrator` dans un autre service (ex: service de génération de tuiles).

## 1. Mise à jour de la Configuration

Pour activer le cache LMDB, vous devez ajouter la section `lmdb` dans l'objet de configuration passé à `createOrchestrator`.

Dans votre fonction `setupOrchestrator`, mettez à jour la construction de `orchConfig` :

```typescript
// ... imports et setup

const orchConfig: any = {
  queue: {
    // ... config existante
    concurrency: config.orchestrator.queue.concurrency,
    // ...
  },
  storage: {
    cacheDir,
    maxFileSize: config.orchestrator.storage.maxFileSize
  },
  logging: {
    level: logLevel,
    file: config.orchestrator.logging.file
  },
  // AJOUTER CETTE SECTION
  lmdb: {
    path: path.join(cacheDir, 'lmdb'), // Chemin vers la DB (dans le dossier cache)
    mapSize: 104857600 // Taille max (100MB par défaut), ajuster si nécessaire
  }
};

// ... suite du code
currentOrchestrator = createOrchestrator(orchConfig, modelConfig, fakeMode);
```

**Note :** L'orchestrator s'occupe automatiquement de :
*   Initialiser la base de données.
*   Reconstruire l'index au démarrage si des fichiers existent déjà.
*   Mettre à jour l'index lors des téléchargements.
*   Nettoyer les vieilles clés lors du nettoyage des fichiers.

## 2. Accéder aux données du cache

Une fois l'orchestrateur démarré, vous pouvez récupérer le chemin d'un fichier directement depuis le cache (sans scanner le disque) via la méthode `getPath(modelKey, timestamp)`.

### Signature
```typescript
getPath(modelKey: string, timestamp: string): string | null
```

*   `modelKey`: La clé du modèle (ex: `'dwd_icon_d2'`, `'meteofrance_arome_france_hd'`).
*   `timestamp`: Le timestamp du fichier recherché (format compact: `YYYYMMDDHHmm`).
    *   Exemple: `202512150600` pour le 15 Décembre 2025 à 06h00.
*   **Retour**: Le chemin absolu du fichier s'il existe, ou `null`.

### Exemple d'utilisation

Dans votre service, là où vous avez besoin d'accéder à un fichier GRIB/OM :

```typescript
import { getOrchestrator } from './path/to/orchestrator-setup';

function getTileSourceFile(model: string, time: string) {
  const orchestrator = getOrchestrator();

  if (orchestrator) {
    // Essayer de récupérer via le cache (très rapide)
    // time doit être au format "202512150600"
    const cachedPath = orchestrator.getPath(model, time);

    if (cachedPath) {
      return cachedPath;
    }
  }

  // Fallback si l'orchestrateur n'est pas prêt ou fichier absent
  return findFileOnDisk(model, time);
}
```

## 3. Avantages
*   **Performance** : Recherche immédiate en O(1) au lieu de parcourir les dossiers.
*   **Persistance** : L'index survit aux redémarrages (grâce au fichier LMDB et à la reconstruction automatique).
*   **Synchronisation** : Le cache est toujours synchrone avec les opérations de téléchargement et de nettoyage de l'orchestrateur.
