const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { open } = require('lmdb');
const {ForecastHistory, setupForecastHistory} = require('../lib');
const {formatTimestampKey} = require('../lib/time-paths');

const model = 'test-model';
const hour = 3_600_000;
const now = Date.UTC(2026, 10, 19, 17);
const on = (hours) => Date.UTC(2026, 10, 19, hours);

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'forecast-history-'));
  const lmdb = open(path.join(root, 'lmdb'));
  const db = lmdb.openDB({ name: model });
  const cache = { lmdb, dbs: { [model]: db } };
  const createHistory = () => new ForecastHistory(cache, root, model, async () => true, assert.fail);
  const publishFor = (name, run, ...times) => {
    const iso = new Date(run).toISOString();
    const folder = path.join(root, name, iso.slice(0, 10).replaceAll('-', '/'), iso.slice(11, 16).replace(':', '') + 'Z');
    mkdirSync(folder, { recursive: true });
    return times.map((time) => {
      const file = path.join(folder, formatTimestampKey(time) + '.om');
      writeFileSync(file, 'completed OM fixture');
      return file;
    });
  };
  t.after(async () => {
    await lmdb.close();
    rmSync(root, { recursive: true, force: true });
  });
  const publish = (run, ...times) => publishFor(model, run, ...times);
  return { cache, root, createHistory, publish, publishFor, get: (time) => db.get(formatTimestampKey(time)) };
}

test('keeps 36 hours before the active run, handles missing and late runs, and retires superseded files', async (t) => {
  const { createHistory, publish, get } = fixture(t);
  const history = createHistory();
  const start = on(15) - 36 * hour;
  const [oldBoundary, boundary] = publish(start - hour, start - hour, start);
  const [, , , before15, , from9At14, from9At15, from9At16] = publish(
    on(9), on(9), on(10), on(11), on(12), on(13), on(14), on(15), on(16)
  );
  await history.sync(now);
  assert.equal(get(on(15)), from9At15);
  assert.equal(get(start - hour), oldBoundary);

  const [from15At15] = publish(on(15), on(15));
  await history.sync(now + 1);
  assert.equal(get(on(15)), from15At15);
  assert.equal(get(on(16)), from9At16);
  assert.equal(get(start), boundary);
  assert.equal(get(start - hour), undefined);

  const [from15At16] = publish(on(15), on(16), on(17));
  await history.sync(now + 2);
  assert.equal(get(start), boundary);
  assert.equal(get(start - hour), undefined);
  assert.equal(get(on(12)), before15);
  assert.equal(get(on(14)), from9At14);
  assert.equal(get(on(15)), from15At15);
  assert.equal(get(on(16)), from15At16);
  assert.ok(existsSync(from9At16));

  const [, , from12At14, from12At15] = publish(on(12), on(12), on(13), on(14), on(15));
  await history.sync(now + 3);
  assert.equal(get(on(14)), from12At14);
  assert.equal(get(on(15)), from15At15);
  assert.ok(existsSync(from9At14));

  // A new instance must honour both the active run and the deadlines written by the old one.
  await createHistory().sync(now + 16 * 60_000);
  assert.equal(get(start), boundary);
  assert.ok(existsSync(boundary));
  assert.equal(get(on(14)), from12At14);
  assert.equal(get(on(15)), from15At15);
  for (const retired of [oldBoundary, from9At14, from9At15, from9At16, from12At15]) {
    assert.ok(!existsSync(retired), retired);
  }
});

test('uses the older file when a newer active run has a hole, and removes a vanished file from the index', async (t) => {
  const { createHistory, publish, get } = fixture(t);
  const history = createHistory();
  const [, , , fallback] = publish(on(9), on(9), on(10), on(11), on(18));
  publish(on(15), on(15), on(16), on(17));
  await history.sync(now + 25 * hour);
  assert.equal(get(on(18)), fallback);
  assert.equal(history.shouldDownload(new Date(on(18)).toISOString(), new Date(on(15)).toISOString()), true);
  assert.equal(history.shouldDownload(new Date(on(18)).toISOString(), new Date(on(6)).toISOString()), false);

  unlinkSync(fallback);
  await history.sync(now + 25 * hour + 1);
  assert.equal(get(on(18)), undefined);
});

test('a single file at +1 can activate a run at midnight and keep the previous value at +0', async (t) => {
  const { createHistory, publish, get } = fixture(t);
  const history = createHistory();
  const [, , , atMidnight] = publish(on(-3), on(-3), on(-2), on(-1), on(0));
  const [old, boundary] = publish(on(-37), on(-37), on(-36));
  const [afterMidnight] = publish(on(0), on(1));
  await history.sync(now);
  assert.equal(get(on(0)), atMidnight);
  assert.equal(get(on(1)), afterMidnight);
  assert.equal(get(on(-37)), undefined);
  assert.equal(get(on(-36)), boundary);
  assert.ok(existsSync(old));
});

test('keeps rolling history for all active downloaded OM models, including 15-minute steps', async (t) => {
  const { cache, root, publish, publishFor, get } = fixture(t);
  const subHourly = 'test-15min';
  const subHourlyDb = cache.lmdb.openDB({ name: subHourly });
  const calls = [];
  const rebuilt = [];
  const pathCache = {
    ...cache,
    dbs: { ...cache.dbs, [subHourly]: subHourlyDb },
    async rebuild(config) { rebuilt.push(...Object.keys(config.models)); }
  };
  const orch = {
    pathCache: undefined,
    async updateIndex(relativePath) { calls.push(relativePath); },
    async cleanupModelFiles(name) { calls.push(name); return 1; },
    async processValidTime() { calls.push('download'); return true; }
  };
  const policy = { enabled: true, fileExtension: '.om' };
  const models = {
    [model]: policy,
    [subHourly]: policy,
    legacy: { ...policy, managed: false },
    disabled: { ...policy, enabled: false },
    optedOut: { ...policy, forecastHistory: false }
  };
  const service = setupForecastHistory(orch, models, root, async () => true, assert.fail);
  const run = Date.now() - 10 * hour;
  const init = Math.floor(run / hour) * hour;
  const [file] = publish(init, init, init + hour, init + 2 * hour);
  const cutoff = init - 36 * hour;
  const quarter = hour / 4;
  const [, oldStep] = publishFor(subHourly, cutoff - hour, cutoff - quarter, cutoff);
  const [newStep] = publishFor(subHourly, init, init + quarter);
  const lateRun = init + hour;
  let updatedFile;
  try {
    orch.pathCache = pathCache;
    await orch.pathCache.rebuild({ models });
    assert.deepEqual(rebuilt, ['legacy', 'disabled', 'optedOut']);
    await service.start();
    assert.equal(get(init), file);
    assert.equal(subHourlyDb.get(formatTimestampKey(cutoff - quarter)), undefined);
    assert.equal(subHourlyDb.get(formatTimestampKey(cutoff)), oldStep);
    assert.equal(subHourlyDb.get(formatTimestampKey(init + quarter)), newStep);
    assert.equal(await orch.cleanupModelFiles(model), 0);
    assert.equal(await orch.cleanupModelFiles(subHourly), 0);
    assert.equal(await orch.cleanupModelFiles('legacy'), 1);
    [updatedFile] = publish(lateRun, lateRun);
    publishFor(subHourly, lateRun, lateRun);
    await orch.updateIndex(path.relative(root, updatedFile));
    await orch.updateIndex('legacy/test.om');
  } finally {
    await service.stop();
  }
  assert.equal(get(lateRun), updatedFile);
  assert.equal(subHourlyDb.get(formatTimestampKey(lateRun)), undefined);
  assert.deepEqual(calls, ['legacy', 'legacy/test.om']);
});
