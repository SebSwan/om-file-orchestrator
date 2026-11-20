const path = require('node:path');
const meteofrance = require('./sources/meteofrance');
const { validateResourceBudget } = require('./resources');
function integer(value, name, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
}
/** Pure configuration checks: never reads GRIB, accesses the network or creates directories. */
function validateIngestionSettings(settings, config, source = meteofrance, rules) {
  if (!settings || typeof settings.provider !== 'string') throw new Error('An ingestion provider is required');
  if (!Array.isArray(settings.variables) || !settings.variables.length || new Set(settings.variables).size !== settings.variables.length || settings.variables.some(v => typeof v !== 'string' || !/^[a-zA-Z0-9_]+$/.test(v))) throw new Error('An explicit unique variable selection is required');
  if (rules && settings.variables.some(variable => !rules.some(rule => rule.name === variable))) throw new Error('Unknown selected variable in converter profile');
  const layout = source.sourceLayout(settings);
  if (!Array.isArray(layout.dimensions) || layout.dimensions.length !== 2) throw new Error('Source must provide grid dimensions');
  layout.dimensions.forEach(value => integer(value, 'grid dimension', 1));
  integer(settings.maxForecastHour, 'maxForecastHour', 0);
  integer(settings.downloadConcurrency ?? 1, 'downloadConcurrency', 1, 16);
  integer(settings.downloadTimeoutMs ?? 180000, 'downloadTimeoutMs', 1);
  if (settings.maxFileSize !== undefined) integer(settings.maxFileSize, 'maxFileSize', 4);
  integer(config.queue?.retries ?? 2, 'queue.retries', 0, 100);
  if (!['report','preserve','error'].includes(settings.unknownFields ?? 'report')) throw new Error('Invalid unknownFields policy');
  if (!Number.isFinite(settings.gribRetentionHours ?? 24) || (settings.gribRetentionHours ?? 24) < 0) throw new Error('Invalid GRIB retention');
  if (settings.resources) validateResourceBudget(settings.resources);
  if (typeof config.storage?.cacheDir !== 'string' || !config.storage.cacheDir.trim()) throw new Error('storage.cacheDir is required');
  if (settings.workDirectory !== undefined && (typeof settings.workDirectory !== 'string' || !settings.workDirectory.trim() || path.resolve(settings.workDirectory) === path.resolve(config.storage.cacheDir))) throw new Error('GRIB workDirectory must differ from OM storage');
  if (settings.engine) {
    if (typeof settings.engine.command !== 'string' || !settings.engine.command.trim()) throw new Error('engine.command is required');
    if (settings.engine.timeoutMs !== undefined) integer(settings.engine.timeoutMs, 'engine.timeoutMs', 1);
  }
  return layout;
}
function inspectIngestionConfiguration(config, models, options = {}) {
  const sources = new Map([['meteofrance-grib', meteofrance], ...Object.entries(options.sources ?? {})]);
  const errors = [];
  try {
    integer(config.ingestion?.maxRuns ?? 2, 'ingestion.maxRuns', 1);
    integer(config.ingestion?.preparationConcurrency ?? 1, 'ingestion.preparationConcurrency', 1, config.ingestion?.maxRuns ?? 2);
    integer(config.queue?.concurrency, 'queue.concurrency', 1);
  } catch (error) { errors.push(error.message); }
  const report = Object.entries(models).filter(([, model]) => model.ingestion?.provider).map(([key, model]) => {
    const enabled = model.enabled === true && model.managed !== false;
    const problems = [], warnings = []; let layout;
    try {
      if (!/^\w+$/.test(key)) throw new Error('Invalid GRIB model identifier');
      const source = sources.get(model.ingestion.provider);
      if (!source) throw new Error(`Unknown source: ${model.ingestion.provider}`);
      layout = validateIngestionSettings(model.ingestion, config, source, options.rules);
    } catch (error) { problems.push(error.message); }
    if (!options.rules) warnings.push('Variable names have not been checked against the converter profile');
    if (!model.ingestion.resources) warnings.push('Conversion memory budget is not configured explicitly');
    return { model: key, enabled, ready: problems.length === 0, provider: model.ingestion.provider,
      variables: model.ingestion.variables, packages: model.ingestion.packages, maxForecastHour: model.ingestion.maxForecastHour,
      dimensions: layout?.dimensions, storageDirectory: config.storage?.cacheDir,
      workDirectory: model.ingestion.workDirectory ?? (config.storage?.cacheDir ? path.join(config.storage.cacheDir, '.mf-ingestion') : undefined),
      errors: problems, warnings };
  });
  return { valid: !errors.length && report.every(model => !model.enabled || model.ready), errors, models: report };
}
module.exports = { validateIngestionSettings, inspectIngestionConfiguration };
