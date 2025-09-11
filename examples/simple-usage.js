/**
 * Example: Simple Usage
 * This example shows basic usage of the Weather Orchestrator as a library
 */

const { createOrchestratorWithDefaults, loadConfigurations } = require('../lib/index');

async function simpleExample() {
  console.log('🚀 Simple Weather Orchestrator Example');

  // Create orchestrator with default settings
  const orchestrator = createOrchestratorWithDefaults({
    cacheDir: './my-weather-cache',
    concurrency: 1,
    logLevel: 'info',
    fakeMode: true // Use fake mode for this example
  });

  try {
    // Start the orchestrator
    console.log('📡 Starting orchestrator...');
    await orchestrator.start();

    // Wait a bit for it to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get statistics
    console.log('\n📊 Initial Statistics:');
    const stats = orchestrator.getStats();
    console.log(`  Files checked: ${stats.filesChecked}`);
    console.log(`  Files downloaded: ${stats.filesDownloaded}`);
    console.log(`  Errors: ${stats.errors}`);

    // Download a file with high priority
    console.log('\n🚀 Downloading file with high priority...');
    const downloadResult = await orchestrator.downloadWithPriority(
      'dwd_icon_d2/2025/09/11/0600Z/2025-09-11T0600.om',
      1 // High priority
    );
    console.log(`  Download queued: ${downloadResult}`);

    // Wait for download to complete
    console.log('\n⏳ Waiting for download to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get final statistics
    console.log('\n📊 Final Statistics:');
    const finalStats = orchestrator.getStats();
    console.log(`  Files checked: ${finalStats.filesChecked}`);
    console.log(`  Files downloaded: ${finalStats.filesDownloaded}`);
    console.log(`  Files skipped: ${finalStats.filesSkipped}`);
    console.log(`  Errors: ${finalStats.errors}`);

    // Get queue information
    console.log('\n📋 Queue Information:');
    const queueInfo = orchestrator.getQueueInfo();
    console.log(`  Download queue size: ${queueInfo.downloadQueue.size}`);
    console.log(`  Download queue pending: ${queueInfo.downloadQueue.pending}`);

    // Stop the orchestrator
    console.log('\n🛑 Stopping orchestrator...');
    await orchestrator.stop();

    console.log('✅ Example completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    await orchestrator.stop();
  }
}

// Run the example
if (require.main === module) {
  simpleExample()
    .then(() => {
      console.log('🎉 Example finished!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Example failed:', error);
      process.exit(1);
    });
}

module.exports = { simpleExample };

