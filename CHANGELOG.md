# Changelog

## 2.0.2

### Fixed

- A file is never downloaded twice at the same time. `processValidTime` only checks the
  final file on disk, while the status check runs every minute and a large file takes
  several minutes to arrive: every tick re-queued the files still in flight, both
  downloads wrote the same `.tmp`, and the second one failed at rename (ENOENT) after
  using the full bandwidth — about 13 % of all downloads in production. Queued and
  in-flight files are now tracked (`inFlight`) and skipped by `processValidTime` and
  `downloadWithPriority`, which share the new `enqueueDownload`. Covered by
  `test/verify-inflight-dedup.js`.

## 2.0.1

### Fixed

- `dropKeyForFile` compares resolved paths instead of raw strings. The orchestrator indexes
  `path.join(cacheDir, …)` while an external ingestion (a `managed: false` model) may index
  an absolute path; with a relative `cacheDir` the two forms never matched, so cleanup
  deleted the file and kept the key, which then pointed at a missing file until the next
  index rebuild. The guard itself is unchanged: a key repointed at another file (a newer
  run) is still preserved. Covered by `test/verify-drop-key-path-forms.js`.


## 2.0.0

### Breaking

- **`retentionHours` is now honoured.** Until 1.2.0 the value declared per model was
  ignored and cleanup always used 24 h. Existing configurations therefore delete files
  more aggressively after this upgrade — a model declaring `retentionHours: 2` keeps two
  hours of files instead of twenty-four. **Review your values before upgrading.**
  Two clocks are involved, unchanged in nature but now driven by your value: files are
  dropped on their mtime (download/write time), LMDB keys on the forecast step they name.
  With a short retention, the index can therefore outlive the files it points at.

### Added

- **`managed: false`** on a model: it is indexed, rebuilt at startup and cleaned up like
  any other, but never downloaded. For models fed by an external ingestion that drops
  files into `cacheDir/<model>/`. `baseUrl`/`statusFile` are unused for those.
  The guard sits in `checkAndDownloadModel` and `downloadWithPriority`, so no caller can
  bypass it.

### Fixed

- Cleanup no longer throttles deletions to 10 files/second, which turned a large purge
  into tens of minutes; only parallelism is bounded now.
- LMDB key removal and index rebuild write in a single transaction instead of one commit
  per key (~1000x on large caches), and the index rebuild skips models with no open
  database instead of walking their directories for nothing.
- `test/test-scenarios.js` no longer reports a false failure for the priority scenario
  (the function was imported but called as a method).
