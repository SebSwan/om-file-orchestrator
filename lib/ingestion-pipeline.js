// Bounded preparation and conversion lanes owned by the orchestrator.
class Lane {
  constructor(concurrency, changed = () => {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid lane concurrency');
    this.concurrency = concurrency; this.changed = changed; this.active = 0; this.waiting = [];
  }
  get queued() { return this.waiting.length; }
  async run(task) {
    if (this.active >= this.concurrency) await new Promise(resolve => { this.waiting.push(resolve); this.changed(); });
    else this.active++;
    this.changed();
    try { return await task(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; this.changed(); }
  }
}
class IngestionPipeline {
  constructor(maxRuns = 2, preparations = 1, changed = () => {}) {
    if (!Number.isInteger(maxRuns) || maxRuns < 1 || preparations > maxRuns) throw new Error('Invalid pipeline capacity');
    this.maxRuns = maxRuns; this.changed = changed; this.admitted = new Set();
    this.preparation = new Lane(preparations, () => this.emit());
    this.conversion = new Lane(1, () => this.emit());
  }
  snapshot() { return { runs: this.admitted.size, preparationActive: this.preparation.active, preparationQueued: this.preparation.queued, conversionActive: this.conversion.active, conversionQueued: this.conversion.queued }; }
  emit() { this.changed(this.snapshot()); }
  admit(key) { if (this.admitted.has(key) || this.admitted.size >= this.maxRuns) return false; this.admitted.add(key); this.emit(); return true; }
  release(key) { this.admitted.delete(key); this.emit(); }
}
module.exports = { Lane, IngestionPipeline };
