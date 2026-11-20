const { readFile, statfs, mkdir } = require('node:fs/promises');
const { freemem } = require('node:os');
function validateResourceBudget(budget) {
  if (!Number.isSafeInteger(budget?.memoryBytes) || budget.memoryBytes <= 0) throw new Error('Invalid conversion memory budget');
  for (const key of ['memoryReserveBytes','diskReserveBytes']) if (budget[key] !== undefined && (!Number.isSafeInteger(budget[key]) || budget[key] < 0)) throw new Error(`Invalid resource reserve: ${key}`);
}
async function availableMemory(system = {}) {
  const read = system.readFile ?? readFile;
  let available = (system.freemem ?? freemem)();
  try { const match = /^MemAvailable:\s+(\d+)/m.exec(await read('/proc/meminfo', 'utf8')); if (match) available = Number(match[1]) * 1024; } catch { /* non-Linux */ }
  try {
    const maximum = (await read('/sys/fs/cgroup/memory.max', 'utf8')).trim();
    if (/^\d+$/.test(maximum)) {
      const current = (await read('/sys/fs/cgroup/memory.current', 'utf8')).trim();
      if (/^\d+$/.test(current)) available = Math.min(available, Number(maximum) - Number(current));
    }
  } catch { /* no cgroup v2 budget */ }
  if (!Number.isFinite(available)) throw new Error('Unable to determine available memory');
  return Math.max(0, available);
}
async function checkResources(directory, outputBytes, budget, system = {}) {
  validateResourceBudget(budget);
  if (!Number.isSafeInteger(outputBytes) || outputBytes < 0) throw new Error('Invalid estimated output size');
  const requiredDiskBytes = outputBytes + (budget.diskReserveBytes ?? 256 * 1024 ** 2);
  const requiredMemoryBytes = budget.memoryBytes + (budget.memoryReserveBytes ?? 128 * 1024 ** 2);
  if (!Number.isSafeInteger(requiredDiskBytes) || !Number.isSafeInteger(requiredMemoryBytes)) throw new Error('Resource requirements exceed safe integer range');
  await (system.mkdir ?? mkdir)(directory, { recursive: true });
  const fs = await (system.statfs ?? statfs)(directory);
  const state = { diskBytes: fs.bavail * fs.bsize, memoryBytes: await (system.availableMemory ?? availableMemory)(), requiredDiskBytes, requiredMemoryBytes };
  if (!Number.isFinite(state.diskBytes) || !Number.isFinite(state.memoryBytes)) throw new Error('Unable to determine available resources');
  if (state.diskBytes < state.requiredDiskBytes) throw new Error('Insufficient output disk space before conversion');
  if (state.memoryBytes < state.requiredMemoryBytes) throw new Error('Insufficient memory before conversion');
  return state;
}
module.exports = { availableMemory, checkResources, validateResourceBudget };
