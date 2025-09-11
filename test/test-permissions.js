const fs = require('fs-extra');
const path = require('path');

/**
 * Test simple des permissions d'écriture
 * Ce script teste si on peut écrire dans le dossier de cache
 */
async function testPermissions() {
  console.log('🔍 Testing write permissions...');

  // Utiliser le même dossier de cache que la config
  const config = require('../config.json');
  const cacheDir = config.storage.cacheDir;
  const testFilePath = path.join(cacheDir, 'test.txt');
  const testContent = 'Permission test - ' + new Date().toISOString();

  try {
    // Créer le dossier si nécessaire
    await fs.ensureDir(cacheDir);
    console.log(`📁 Cache directory: ${cacheDir}`);

    // Test d'écriture
    await fs.writeFile(testFilePath, testContent);
    console.log(`✅ Write test successful: ${testFilePath}`);

    // Test de lecture
    const readContent = await fs.readFile(testFilePath, 'utf8');
    if (readContent !== testContent) {
      throw new Error("Read content doesn't match written content");
    }
    console.log(`✅ Read test successful: content matches`);

    // Test de suppression
    await fs.remove(testFilePath);
    console.log(`✅ Delete test successful: ${testFilePath}`);

    console.log('✅ All permission tests passed - cache directory is writable');
    return true;

  } catch (error) {
    console.error('❌ Permission test failed!');
    console.error(`   Cache directory: ${cacheDir}`);
    console.error(`   Test file: ${testFilePath}`);
    console.error(`   Error: ${error.message}`);

    // Nettoyer le fichier test s'il existe encore
    try {
      await fs.remove(testFilePath);
    } catch (cleanupError) {
      console.warn(`⚠️  Could not clean up test file: ${cleanupError.message}`);
    }

    return false;
  }
}

// Exécuter le test si le script est appelé directement
if (require.main === module) {
  testPermissions()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testPermissions };
