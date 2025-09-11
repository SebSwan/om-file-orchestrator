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
function createOrchestrator(config, modelConfig, fakeMode = false) {
  return new WeatherOrchestratorSimple(config, modelConfig, fakeMode);
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

  // Default model configuration with a few popular models
  const defaultModelConfig = {
    models: {
      dwd_icon_d2: {
        name: "DWD ICON D2",
        baseUrl: "https://openmeteo.s3.amazonaws.com/data_spatial/dwd_icon_d2",
        statusFile: "/in-progress.json",
        checkInterval: "*/1 * * * *",
        fileExtension: ".om",
        pathPattern: "{year}/{month}/{day}/{runHour}/{forecastTime}.om",
        enabled: true,
        retentionHours: 24
      },
      ecmwf_ifs025: {
        name: "ECMWF IFS025",
        baseUrl: "https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs025",
        statusFile: "/in-progress.json",
        checkInterval: "*/1 * * * *",
        fileExtension: ".om",
        pathPattern: "{year}/{month}/{day}/{runHour}/{forecastTime}.om",
        enabled: false,
        retentionHours: 24
      }
    }
  };

  return new WeatherOrchestratorSimple(defaultConfig, defaultModelConfig, options.fakeMode);
}

/**
 * Utility function to load configurations from files
 * @param {string} configPath - Path to config.json
 * @param {string} modelConfigPath - Path to config_model.json
 * @returns {Object} Object containing config and modelConfig
 */
function loadConfigurations(configPath = './config.json', modelConfigPath = './config_model.json') {
  const fs = require('fs');
  const path = require('path');

  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  const modelConfig = JSON.parse(fs.readFileSync(path.resolve(modelConfigPath), 'utf8'));

  return { config, modelConfig };
}

module.exports = {
  // Main class
  WeatherOrchestratorSimple,

  // Factory functions
  createOrchestrator,
  createOrchestratorWithDefaults,
  loadConfigurations,

  // Version
  version: require('../package.json').version
};

