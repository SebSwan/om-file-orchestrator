# Usage Examples

This directory contains examples showing how to use the Weather Data Orchestrator as a library in your Node.js applications.

## Examples

### 1. Simple Usage (`simple-usage.js`)
Basic example showing how to create and use an orchestrator with default settings.

```bash
node examples/simple-usage.js
```

**Features demonstrated:**
- Creating orchestrator with defaults
- Starting/stopping orchestrator
- Downloading files with priority
- Getting statistics and queue information

### 2. Fastify Integration (`fastify-integration.js`)
Complete example showing how to integrate the orchestrator with a Fastify web server.

```bash
# Install Fastify first
npm install fastify

# Run the example
node examples/fastify-integration.js
```

**Features demonstrated:**
- REST API endpoints for orchestrator control
- Web server integration
- Graceful startup/shutdown
- Health check endpoint

**API Endpoints:**
- `GET /api/weather/stats` - Get orchestrator statistics
- `GET /api/weather/queue` - Get queue information
- `POST /api/weather/check/:modelKey` - Trigger manual check
- `POST /api/weather/download` - Download file with priority
- `POST /api/weather/cleanup` - Trigger manual cleanup
- `GET /health` - Health check

### 3. Custom Configuration (`custom-config.js`)
Example showing how to create custom configurations programmatically.

```bash
node examples/custom-config.js
```

**Features demonstrated:**
- Loading configurations from files
- Creating custom configurations
- Custom queue settings
- Custom model configurations
- Different retention periods

## Installation as Library

### From npm (recommended)
```bash
npm install om-file-orchestrator
```

### From GitHub
```bash
npm install github:SebSwan/om-file-orchestrator
```

### From local directory
```bash
npm install /path/to/om-file-orchestrator
```

## Basic Usage

```javascript
const { createOrchestratorWithDefaults } = require('om-file-orchestrator');

// Create orchestrator with defaults
const orchestrator = createOrchestratorWithDefaults({
  cacheDir: './weather-cache',
  concurrency: 2,
  logLevel: 'info',
  fakeMode: false
});

// Start orchestrator
await orchestrator.start();

// Download file with priority
await orchestrator.downloadWithPriority(
  'dwd_icon_d2/2025/09/11/0600Z/2025-09-11T0600.om',
  1 // High priority
);

// Get statistics
const stats = orchestrator.getStats();

// Stop orchestrator
await orchestrator.stop();
```

## Advanced Usage

```javascript
const { createOrchestrator, loadConfigurations } = require('om-file-orchestrator');

// Load configurations from files
const { config, modelConfig } = loadConfigurations(
  './my-config.json',
  './my-models.json'
);

// Create orchestrator with custom config
const orchestrator = createOrchestrator(config, modelConfig, false);

// Use orchestrator...
```

## Integration with Web Frameworks

### Express.js
```javascript
const express = require('express');
const { createOrchestratorWithDefaults } = require('om-file-orchestrator');

const app = express();
const orchestrator = createOrchestratorWithDefaults();

app.get('/weather/stats', async (req, res) => {
  const stats = orchestrator.getStats();
  res.json(stats);
});

app.post('/weather/download', async (req, res) => {
  const { filePath, priority } = req.body;
  const result = await orchestrator.downloadWithPriority(filePath, priority);
  res.json({ success: true, queued: result });
});
```

### Koa.js
```javascript
const Koa = require('koa');
const Router = require('@koa/router');
const { createOrchestratorWithDefaults } = require('om-file-orchestrator');

const app = new Koa();
const router = new Router();
const orchestrator = createOrchestratorWithDefaults();

router.get('/weather/stats', async (ctx) => {
  const stats = orchestrator.getStats();
  ctx.body = stats;
});

app.use(router.routes());
```

## Error Handling

```javascript
const { createOrchestratorWithDefaults } = require('om-file-orchestrator');

async function safeOrchestratorUsage() {
  const orchestrator = createOrchestratorWithDefaults();

  try {
    await orchestrator.start();

    // Your orchestrator operations here

  } catch (error) {
    console.error('Orchestrator error:', error.message);
  } finally {
    // Always stop the orchestrator
    await orchestrator.stop();
  }
}
```

## Best Practices

1. **Always stop the orchestrator** when your application shuts down
2. **Use try-catch blocks** for error handling
3. **Set appropriate concurrency** based on your server capacity
4. **Use fake mode** for testing and development
5. **Monitor statistics** to track performance
6. **Configure retention periods** to manage disk space
7. **Use priority downloads** for urgent files
8. **Test permissions** before deployment

