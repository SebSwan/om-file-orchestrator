const { testPermissions } = require('./test-permissions');
const fs = require('fs-extra');
const path = require('path');

/**
 * Script de test pour différents scénarios
 */
class TestScenarios {
  constructor() {
    this.config = require('../config.json');
    this.cacheDir = this.config.storage.cacheDir;
    this.results = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${timestamp} ${prefix} ${message}`);
  }

  async runTest(name, testFunction) {
    this.log(`Running test: ${name}`);
    try {
      const result = await testFunction();
      this.results.push({ name, success: true, result });
      this.log(`Test passed: ${name}`, 'success');
      return result;
    } catch (error) {
      this.results.push({ name, success: false, error: error.message });
      this.log(`Test failed: ${name} - ${error.message}`, 'error');
      return false;
    }
  }

  async testCacheDirectoryCreation() {
    // Test de création du dossier de cache
    await fs.ensureDir(this.cacheDir);
    const exists = await fs.pathExists(this.cacheDir);
    if (!exists) {
      throw new Error(`Cache directory was not created: ${this.cacheDir}`);
    }
    return true;
  }

  async testFileOperations() {
    // Test des opérations de fichiers
    const testFile = path.join(this.cacheDir, 'test-operations.txt');
    const content = 'Test content - ' + Date.now();

    // Écriture
    await fs.writeFile(testFile, content);

    // Lecture
    const readContent = await fs.readFile(testFile, 'utf8');
    if (readContent !== content) {
      throw new Error('Read content does not match written content');
    }

    // Suppression
    await fs.remove(testFile);

    return true;
  }

  async testSubdirectoryCreation() {
    // Test de création de sous-dossiers (comme dans la structure de l'orchestrateur)
    const subDir = path.join(this.cacheDir, 'dwd_icon_d2', '2025', '09', '11', '0600Z');
    await fs.ensureDir(subDir);

    const exists = await fs.pathExists(subDir);
    if (!exists) {
      throw new Error(`Subdirectory was not created: ${subDir}`);
    }

    // Nettoyer
    await fs.remove(path.join(this.cacheDir, 'dwd_icon_d2'));

    return true;
  }

  async testConcurrentWrites() {
    // Test d'écritures concurrentes
    const promises = [];
    for (let i = 0; i < 5; i++) {
      const testFile = path.join(this.cacheDir, `concurrent-test-${i}.txt`);
      promises.push(fs.writeFile(testFile, `Content ${i}`));
    }

    await Promise.all(promises);

    // Vérifier que tous les fichiers existent
    for (let i = 0; i < 5; i++) {
      const testFile = path.join(this.cacheDir, `concurrent-test-${i}.txt`);
      const exists = await fs.pathExists(testFile);
      if (!exists) {
        throw new Error(`Concurrent write test failed for file ${i}`);
      }
    }

    // Nettoyer
    for (let i = 0; i < 5; i++) {
      const testFile = path.join(this.cacheDir, `concurrent-test-${i}.txt`);
      await fs.remove(testFile);
    }

    return true;
  }

  async testLargeFileHandling() {
    // Test de gestion de gros fichiers (simulation)
    const testFile = path.join(this.cacheDir, 'large-test.txt');
    const largeContent = 'X'.repeat(1024 * 1024); // 1MB

    await fs.writeFile(testFile, largeContent);

    const stats = await fs.stat(testFile);
    if (stats.size !== largeContent.length) {
      throw new Error(`Large file size mismatch: expected ${largeContent.length}, got ${stats.size}`);
    }

    await fs.remove(testFile);
    return true;
  }

  async runAllTests() {
    this.log('🚀 Starting comprehensive test suite...');

    await this.runTest('Cache Directory Creation', () => this.testCacheDirectoryCreation());
    await this.runTest('Basic Permissions', () => testPermissions());
    await this.runTest('File Operations', () => this.testFileOperations());
    await this.runTest('Subdirectory Creation', () => this.testSubdirectoryCreation());
    await this.runTest('Concurrent Writes', () => this.testConcurrentWrites());
    await this.runTest('Large File Handling', () => this.testLargeFileHandling());

    this.printSummary();
  }

  printSummary() {
    this.log('\n📊 Test Summary:');
    this.log('================');

    const passed = this.results.filter(r => r.success).length;
    const failed = this.results.filter(r => !r.success).length;

    this.log(`Total tests: ${this.results.length}`);
    this.log(`Passed: ${passed}`, passed > 0 ? 'success' : 'info');
    this.log(`Failed: ${failed}`, failed > 0 ? 'error' : 'info');

    if (failed > 0) {
      this.log('\n❌ Failed tests:');
      this.results.filter(r => !r.success).forEach(r => {
        this.log(`  - ${r.name}: ${r.error}`, 'error');
      });
    }

    this.log(`\n${failed === 0 ? '✅ All tests passed!' : '❌ Some tests failed!'}`);
  }
}

// Exécuter les tests si le script est appelé directement
if (require.main === module) {
  const testSuite = new TestScenarios();
  testSuite.runAllTests()
    .then(() => {
      const hasFailures = testSuite.results.some(r => !r.success);
      process.exit(hasFailures ? 1 : 0);
    })
    .catch(error => {
      console.error('💥 Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = TestScenarios;
