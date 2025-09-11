/**
 * Example: Integration with Fastify
 * This example shows how to integrate the Weather Orchestrator with a Fastify web server
 */

const fastify = require('fastify')({ logger: true });
const { createOrchestratorWithDefaults, loadConfigurations } = require('../lib/index');

// Create orchestrator instance
const orchestrator = createOrchestratorWithDefaults({
  cacheDir: './weather-cache',
  concurrency: 2,
  logLevel: 'info',
  fakeMode: false // Set to true for testing
});

// Start orchestrator when server starts
fastify.addHook('onReady', async () => {
  try {
    await orchestrator.start();
    fastify.log.info('Weather Orchestrator started successfully');
  } catch (error) {
    fastify.log.error('Failed to start Weather Orchestrator:', error);
  }
});

// Graceful shutdown
fastify.addHook('onClose', async () => {
  try {
    await orchestrator.stop();
    fastify.log.info('Weather Orchestrator stopped');
  } catch (error) {
    fastify.log.error('Error stopping Weather Orchestrator:', error);
  }
});

// API Routes

// Get orchestrator statistics
fastify.get('/api/weather/stats', async (request, reply) => {
  try {
    const stats = orchestrator.getStats();
    return { success: true, data: stats };
  } catch (error) {
    reply.code(500);
    return { success: false, error: error.message };
  }
});

// Get queue information
fastify.get('/api/weather/queue', async (request, reply) => {
  try {
    const queueInfo = orchestrator.getQueueInfo();
    return { success: true, data: queueInfo };
  } catch (error) {
    reply.code(500);
    return { success: false, error: error.message };
  }
});

// Trigger manual check for a specific model
fastify.post('/api/weather/check/:modelKey', async (request, reply) => {
  try {
    const { modelKey } = request.params;
    await orchestrator.checkNow(modelKey);
    return { success: true, message: `Check triggered for model: ${modelKey}` };
  } catch (error) {
    reply.code(400);
    return { success: false, error: error.message };
  }
});

// Download file with priority
fastify.post('/api/weather/download', async (request, reply) => {
  try {
    const { filePath, priority = 1 } = request.body;

    if (!filePath) {
      reply.code(400);
      return { success: false, error: 'filePath is required' };
    }

    const result = await orchestrator.downloadWithPriority(filePath, priority);
    return {
      success: true,
      message: result ? 'Download queued successfully' : 'File already exists',
      queued: result
    };
  } catch (error) {
    reply.code(400);
    return { success: false, error: error.message };
  }
});

// Trigger manual cleanup
fastify.post('/api/weather/cleanup', async (request, reply) => {
  try {
    await orchestrator.cleanupNow();
    return { success: true, message: 'Cleanup triggered successfully' };
  } catch (error) {
    reply.code(500);
    return { success: false, error: error.message };
  }
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  const stats = orchestrator.getStats();
  return {
    status: 'healthy',
    orchestrator: {
      running: true,
      lastCheck: stats.lastCheck,
      lastCleanup: stats.lastCleanup,
      errors: stats.errors
    }
  };
});

// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('🚀 Fastify server with Weather Orchestrator running on http://localhost:3000');
    console.log('📊 API endpoints:');
    console.log('  GET  /api/weather/stats - Get orchestrator statistics');
    console.log('  GET  /api/weather/queue - Get queue information');
    console.log('  POST /api/weather/check/:modelKey - Trigger manual check');
    console.log('  POST /api/weather/download - Download file with priority');
    console.log('  POST /api/weather/cleanup - Trigger manual cleanup');
    console.log('  GET  /health - Health check');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

