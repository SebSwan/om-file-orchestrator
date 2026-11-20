const fs = require('node:fs');
const path = require('node:path');
function loadModelConfiguration(file) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('A config_model.json path is required');
  const modelConfig = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!modelConfig.models || typeof modelConfig.models !== 'object' || Array.isArray(modelConfig.models)) throw new Error('config_model.json must contain a models object');
  for (const [key, model] of Object.entries(modelConfig.models)) {
    if (!model || typeof model !== 'object' || Array.isArray(model) || typeof model.enabled !== 'boolean') throw new Error(`Model ${key} must declare enabled as a boolean in config_model.json`);
    if (model.maxForecastHour !== undefined && (!Number.isFinite(model.maxForecastHour) || model.maxForecastHour < 0)) throw new Error(`Invalid maxForecastHour for ${key}`);
  }
  return modelConfig;
}
/** A worker scope references catalogue entries; it never overrides their activation/settings. */
function selectConfiguredModels(modelConfig, {modelKeys, modelProvider} = {}) {
  if (modelKeys !== undefined && (!Array.isArray(modelKeys) || modelKeys.some(key => typeof key !== 'string') || new Set(modelKeys).size !== modelKeys.length)) throw new Error('Invalid worker modelKeys');
  if (modelKeys) for (const key of modelKeys) if (!Object.hasOwn(modelConfig.models,key)) throw new Error(`Unknown model in config_model.json: ${key}`);
  return { ...modelConfig, models: Object.fromEntries(Object.entries(modelConfig.models).filter(([key,model]) => (!modelKeys || modelKeys.includes(key)) && (!modelProvider || model.ingestion?.provider === modelProvider))) };
}
function loadConfigurations(configPath = './config.json', modelConfigPath) {
  const source = path.resolve(configPath), input = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (input.models !== undefined || input.orchestrator?.models !== undefined) throw new Error('Model definitions and activation belong only in config_model.json; use modelConfigFile instead of models');
  const reference = modelConfigPath ?? input.modelConfigFile;
  const file = reference ? path.resolve(modelConfigPath ? process.cwd() : path.dirname(source), reference) : path.resolve(process.cwd(), 'config_model.json');
  const modelConfig = selectConfiguredModels(loadModelConfiguration(file), input);
  return {config: input.orchestrator ?? input, modelConfig, modelConfigPath: file};
}
module.exports = {loadModelConfiguration, selectConfiguredModels, loadConfigurations};
