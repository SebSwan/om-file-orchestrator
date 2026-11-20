const WeatherOrchestrator = require('../WeatherOrchestratorSimple');
const config = require('../config.json');
const modelConfig = require('./fixtures/model-config');

/**
 * Test du système de priorités
 */
async function testPrioritySystem() {
  console.log('🚀 Testing Priority Download System...');

  // Créer l'orchestrateur en mode fake
  const orchestrator = new WeatherOrchestrator(config, modelConfig, true);

  try {
    // Démarrer l'orchestrateur
    await orchestrator.start();

    console.log('\n📋 Test 1: Download normal (priorité 0)');
    await orchestrator.downloadWithPriority('dwd_icon_d2/2025/09/11/0600Z/2025-09-11T0600.om', 0);

    console.log('\n📋 Test 2: Download haute priorité (priorité 1)');
    await orchestrator.downloadWithPriority('dwd_icon_d2/2025/09/11/0600Z/2025-09-11T0700.om', 1);

    console.log('\n📋 Test 3: Download priorité maximale (priorité 2)');
    await orchestrator.downloadWithPriority('dwd_icon_d2/2025/09/11/0600Z/2025-09-11T0800.om', 2);

    console.log('\n📋 Test 4: Download priorité normale (priorité 0)');
    await orchestrator.downloadWithPriority('dwd_icon_d2/2025/09/11/0600Z/2025-09-11T0900.om', 0);

    // Afficher les informations de la queue
    console.log('\n📊 Queue Information:');
    const queueInfo = orchestrator.getQueueInfo();
    console.log(`  Download queue size: ${queueInfo.downloadQueue.size}`);
    console.log(`  Download queue pending: ${queueInfo.downloadQueue.pending}`);

    // Attendre que les téléchargements se terminent
    console.log('\n⏳ Waiting for downloads to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 secondes pour 4 fichiers

    // Afficher les statistiques finales
    console.log('\n📊 Final Statistics:');
    const stats = orchestrator.getStats();
    console.log(`  Files downloaded: ${stats.filesDownloaded}`);
    console.log(`  Files skipped: ${stats.filesSkipped}`);
    console.log(`  Errors: ${stats.errors}`);

    // Arrêter l'orchestrateur
    await orchestrator.stop();

    console.log('\n✅ Priority system test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await orchestrator.stop();
    process.exit(1);
  }
}

// Exécuter le test si le script est appelé directement
if (require.main === module) {
  testPrioritySystem()
    .then(() => {
      console.log('🎉 All tests passed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { testPrioritySystem };
