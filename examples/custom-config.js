/**
 * Example: Custom Configuration
 * This example shows how to use the orchestrator with custom configurations
 */

const { createOrchestrator, loadConfigurations } = require('../lib/index');

async function customConfigExample() {
  console.log('🚀 Custom Configuration Example');

  try {
    // Method 1: Load configurations from files
    console.log('📁 Loading configurations from files...');
    const { config, modelConfig } = loadConfigurations('./config.json', process.env.OM_MODEL_CONFIG_FILE);

    // Create orchestrator with loaded configurations
    const orchestrator1 = createOrchestrator(config, modelConfig, true); // fake mode

    console.log('✅ Orchestrator created with file-based configuration');
    await orchestrator1.stop();

    // Method 2: Create custom configuration programmatically
    console.log('\n⚙️  Creating custom configuration...');

    const customConfig = {
      queue: {
        concurrency: 3,
        interval: 500,
        intervalCap: 20,
        timeout: 30000,
        retries: 2
      },
      storage: {
        cacheDir: './custom-cache',
        maxFileSize: 50000000 // 50MB
      },
      logging: {
        level: 'debug',
        file: './custom-logs/orchestrator.log'
      }
    };

    const customModelConfig = modelConfig; // Same canonical catalogue.

    // Create orchestrator with custom configuration
    const orchestrator2 = createOrchestrator(customConfig, customModelConfig, true);

    console.log('✅ Orchestrator created with custom configuration');
    console.log('📊 Configuration details:');
    console.log(`  Cache directory: ${customConfig.storage.cacheDir}`);
    console.log(`  Concurrency: ${customConfig.queue.concurrency}`);
    console.log(`  Log level: ${customConfig.logging.level}`);
    console.log(`  Models enabled: ${Object.keys(customModelConfig.models).length}`);

    // Start and run briefly
    await orchestrator2.start();

    // Get queue info
    const queueInfo = orchestrator2.getQueueInfo();
    console.log(`  Download queue concurrency: ${customConfig.queue.concurrency}`);

    // Stop
    await orchestrator2.stop();

    console.log('✅ Custom configuration example completed!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the example
if (require.main === module) {
  customConfigExample()
    .then(() => {
      console.log('🎉 Custom configuration example finished!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Example failed:', error);
      process.exit(1);
    });
}

module.exports = { customConfigExample };

