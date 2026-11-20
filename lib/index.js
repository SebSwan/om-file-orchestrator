/**
 * Weather Data Orchestrator Library
 * Main entry point for importing the orchestrator as a library
 */

const WeatherOrchestratorSimple = require('../WeatherOrchestratorSimple');

/**
 * Create a new Weather Orchestrator instance
 * @param {Object} config - Main configuration object
 * @param {Object} modelConfig - Model configuration object
 * @param {boolean} fakeMode - Enable fake mode for testing
 * @returns {WeatherOrchestratorSimple} Orchestrator instance
 */
function createOrchestrator(config, modelConfig, fakeMode = false, options = {}) {
  const orchestrator = new WeatherOrchestratorSimple(config, modelConfig, fakeMode);
  for (const [name, converter] of Object.entries(options.converters ?? {})) orchestrator.registerConverter(name, converter);
  for (const [name, source] of Object.entries(options.sources ?? {})) orchestrator.registerSource(name, source);
  return orchestrator;
}

/**
 * Create orchestrator with default configurations
 * @param {Object} options - Configuration options
 * @param {string} options.cacheDir - Cache directory path
 * @param {number} options.concurrency - Download concurrency
 * @param {string} options.logLevel - Log level (debug, info, warn, error)
 * @param {boolean} options.fakeMode - Enable fake mode
 * @returns {WeatherOrchestratorSimple} Orchestrator instance
 */
function createOrchestratorWithDefaults(options = {}) {
  const defaultConfig = {
    queue: {
      concurrency: options.concurrency || 1,
      interval: 1000,
      intervalCap: 10,
      timeout: 60000,
      retries: 3
    },
    storage: {
      cacheDir: options.cacheDir || './cache',
      maxFileSize: 30971520 // 30MB
    },
    logging: {
      level: options.logLevel || 'info',
      file: './logs/orchestrator.log'
    }
  };

  const modelConfig = options.modelConfig ?? (options.modelConfigPath ? require('./model-configuration').loadModelConfiguration(options.modelConfigPath) : undefined);
  if (!modelConfig) throw new Error('Provide modelConfig or modelConfigPath from your config_model.json');
  return createOrchestrator(defaultConfig, modelConfig, options.fakeMode, options);
}

/**
 * Utility function to load configurations from files
 * @param {string} configPath - Path to config.json
 * @param {string} modelConfigPath - Path to config_model.json
 * @returns {Object} Object containing config and modelConfig
 */
function loadConfigurations(configPath = './config.json', modelConfigPath) {
  return require('./model-configuration').loadConfigurations(configPath, modelConfigPath);
}

module.exports = {
  IngestionTelemetry: require('./telemetry').IngestionTelemetry,
  meteofrance: require('./sources/meteofrance'),
  ingestWorkflow: require('./grib-workflow').ingestWorkflow,
  // Main class
  WeatherOrchestratorSimple,

  // Factory functions
  createOrchestrator,
  createOrchestratorWithDefaults,
  loadConfigurations,

  // Version
  version: require('../package.json').version
};


// Explicit assignments also expose stable named imports to Node ESM consumers.
module.exports.createOrchestrator = createOrchestrator;
module.exports.createOrchestratorWithDefaults = createOrchestratorWithDefaults;
module.exports.loadConfigurations = loadConfigurations;
module.exports.WeatherOrchestratorSimple = WeatherOrchestratorSimple;

module.exports.ForecastHistory = require('./forecast-history').ForecastHistory;
module.exports.setupForecastHistory = require('./forecast-history').setupForecastHistory;

module.exports.inspectIngestionConfiguration = require('./ingestion-validation').inspectIngestionConfiguration;

module.exports.loadModelConfiguration = require('./model-configuration').loadModelConfiguration;
module.exports.selectConfiguredModels = require('./model-configuration').selectConfiguredModels;
