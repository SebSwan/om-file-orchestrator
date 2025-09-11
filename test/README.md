# Tests de l'Orchestrateur de Fichiers Météo

Ce dossier contient les tests pour vérifier le bon fonctionnement de l'orchestrateur, en particulier les permissions d'écriture et les opérations de fichiers.

## 📁 Fichiers de Test

### `test-permissions.js`
Test simple des permissions d'écriture dans le dossier de cache.

**Utilisation :**
```bash
node test/test-permissions.js
```

**Ce que ça teste :**
- ✅ Création du dossier de cache
- ✅ Écriture d'un fichier test
- ✅ Lecture du fichier test
- ✅ Suppression du fichier test

### `test-scenarios.js`
Suite de tests complète pour différents scénarios.

**Utilisation :**
```bash
node test/test-scenarios.js
```

**Ce que ça teste :**
- ✅ Création du dossier de cache
- ✅ Permissions de base
- ✅ Opérations de fichiers (écriture/lecture/suppression)
- ✅ Création de sous-dossiers (structure de l'orchestrateur)
- ✅ Écritures concurrentes
- ✅ Gestion de gros fichiers

### `test-priority.js`
Test du système de priorités pour les téléchargements.

**Utilisation :**
```bash
node test/test-priority.js
```

**Ce que ça teste :**
- ✅ Téléchargements avec priorité 0 (normale)
- ✅ Téléchargements avec priorité 1 (élevée)
- ✅ Téléchargements avec priorité 2 (maximale)
- ✅ Ordre d'exécution des priorités
- ✅ Gestion de la queue avec priorités

## 🚀 Tests Rapides

### Test des permissions uniquement
```bash
node test/test-permissions.js
```

### Suite de tests complète
```bash
node test/test-scenarios.js
```

### Test avec l'orchestrateur en mode fake
```bash
npm run start:fake
```

### Test du système de priorités
```bash
npm run test:priority
```

## 📊 Interprétation des Résultats

### ✅ Succès
```
✅ All permission tests passed - cache directory is writable
```

### ❌ Échec
```
❌ Permission test failed!
   Cache directory: ./cache
   Test file: ./cache/test.txt
   Error: EACCES: permission denied, open './cache/test.txt'
```

## 🔧 Résolution des Problèmes

### Problème de permissions
Si vous obtenez une erreur `EACCES: permission denied` :

1. **Vérifiez les permissions du dossier :**
   ```bash
   ls -la cache/
   ```

2. **Donnez les permissions d'écriture :**
   ```bash
   chmod 755 cache/
   ```

3. **Ou changez le propriétaire :**
   ```bash
   sudo chown -R $USER:$USER cache/
   ```

### Problème d'espace disque
Si vous obtenez une erreur `ENOSPC: no space left on device` :

1. **Vérifiez l'espace disque :**
   ```bash
   df -h
   ```

2. **Nettoyez le cache si nécessaire :**
   ```bash
   rm -rf cache/*
   ```

## 🎯 Cas d'Usage

### Avant le déploiement
Exécutez toujours les tests avant de déployer sur un serveur :

```bash
# Test rapide
node test/test-permissions.js

# Si OK, test complet
node test/test-scenarios.js

# Si tout est OK, test avec l'orchestrateur
npm run start:fake
```

### Sur un serveur de production
1. Testez les permissions avant de démarrer l'orchestrateur
2. Vérifiez que le dossier de cache est monté correctement
3. Assurez-vous que l'utilisateur a les bonnes permissions

## 📝 Notes

- Les tests créent des fichiers temporaires qui sont automatiquement supprimés
- Le dossier `cache/` est créé automatiquement si il n'existe pas
- Les tests sont non-destructifs (ils nettoient après eux)
- En cas d'échec, les fichiers temporaires sont supprimés dans la mesure du possible
