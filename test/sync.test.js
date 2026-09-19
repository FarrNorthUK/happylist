import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import db, { getSyncMeta, setSyncMeta } from '../js/db.js';
import { createSync } from '../js/sync.js';

const FILE = 'happylist-data.json';
const BACKUPS = 'backups';

// In-memory fake transport. Mirrors GitHub Contents API semantics:
// PUT without sha = create (409 if exists); PUT with sha = update (409 on mismatch).
function makeFake({ failPut409 = 0, beforePut = null, hangFirstPut = null, getStatus = null } = {}) {
  const files = new Map();
  const calls = { get: 0, put: 0, gets: [], puts: [] };
  let put409 = failPut409;
  let firstPutHang = hangFirstPut;

  const transport = {
    async getFile(path) {
      calls.get++;
      calls.gets.push(path);
      if (getStatus) {
        const scripted = getStatus(path);
        if (scripted) return scripted;
      }
      const f = files.get(path);
      if (!f) return { status: 404 };
      return { status: 200, sha: f.sha, data: f.data };
    },

    async putFile(path, { sha, data, message }) {
      calls.put++;
      calls.puts.push({ path, data });
      if (firstPutHang) {
        const hang = firstPutHang;
        firstPutHang = null;
        await hang();
      }
      if (beforePut) await beforePut(path);
      if (put409 > 0) { put409--; return { status: 409 }; }
      const f = files.get(path);
      if (!f && sha) return { status: 409 };
      if (f && (!sha || f.sha !== sha)) return { status: 409 };
      const newSha = `sha-${files.size + 1}`;
      files.set(path, { sha: newSha, data });
      return { status: 200, sha: newSha };
    },

    async listDir(path) {
      const prefix = `${path}/`;
      const entries = [...files.entries()]
        .filter(([p]) => p.startsWith(prefix))
        .map(([p, f]) => ({ name: p.slice(prefix.length), sha: f.sha }));
      if (!entries.length) return { status: 404 };
      return { status: 200, files: entries };
    },

    async deleteFile(path) {
      files.delete(path);
      return { status: 200 };
    },
  };

  return { transport, files, calls };
}

function makeSync(fake) {
  return createSync({ makeTransport: () => fake.transport });
}

const filePuts = fake => fake.calls.puts.filter(p => p.path === FILE);
const fileGets = fake => fake.calls.gets.filter(p => p === FILE);

async function setCreds() {
  await setSyncMeta('ghRepo', 'user/repo');
  await setSyncMeta('ghPat', 'pat');
}

async function seedItem(overrides = {}) {
  return db.items.add({
    id: 1,
    name: 'Local',
    storeIds: [],
    boughtAt: null,
    removedAt: null,
    deletedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

function remoteFile(items = [], extra = {}) {
  return {
    sha: 'remote-1',
    data: { version: 1, stores: [], items, shoppingRuns: [], checkedItems: [], ...extra },
  };
}

async function waitFor(cond, ms = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise(r => setTimeout(r, 5));
  }
}

beforeEach(async () => {
  await Promise.all([
    db.stores.clear(),
    db.items.clear(),
    db.shoppingRuns.clear(),
    db.checkedItems.clear(),
    db.syncMeta.clear(),
  ]);
});

// ── First sync ──

test('first sync (404) creates the file with local state', async () => {
  await setCreds();
  await seedItem({ name: 'Milk' });
  const fake = makeFake();
  const result = await makeSync(fake).flushSync();

  assert.equal(result.ok, true);
  assert.equal(fake.files.get(FILE).data.items[0].name, 'Milk');
  assert.ok(await getSyncMeta('lastSyncedAt'));
});

test('sync without credentials fails without touching the network', async () => {
  const fake = makeFake();
  const result = await makeSync(fake).flushSync();

  assert.equal(result.ok, false);
  assert.match(result.message, /not configured/i);
  assert.equal(fake.calls.get, 0);
  assert.equal(fake.calls.put, 0);
});

// ── Merge (last-write-wins) ──

test('merge: remote-newer row replaces local', async () => {
  await setCreds();
  await seedItem({ name: 'Local' });
  const fake = makeFake();
  fake.files.set(FILE, remoteFile([{
    id: 1, name: 'Remote', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null,
    updatedAt: '2026-02-01T00:00:00.000Z',
  }]));

  await makeSync(fake).flushSync();

  assert.equal((await db.items.get(1)).name, 'Remote');
});

test('merge: local-newer row wins', async () => {
  await setCreds();
  await seedItem({ name: 'Local', updatedAt: '2026-03-01T00:00:00.000Z' });
  const fake = makeFake();
  fake.files.set(FILE, remoteFile([{
    id: 1, name: 'Remote', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null,
    updatedAt: '2026-02-01T00:00:00.000Z',
  }]));

  await makeSync(fake).flushSync();

  assert.equal((await db.items.get(1)).name, 'Local');
  assert.equal(fake.files.get(FILE).data.items[0].name, 'Local');
});

test('merge: new remote row is added locally', async () => {
  await setCreds();
  await seedItem({ id: 1, name: 'Local' });
  const fake = makeFake();
  fake.files.set(FILE, remoteFile([
    { id: 1, name: 'Local', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 2, name: 'Theirs', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-02-01T00:00:00.000Z' },
  ]));

  await makeSync(fake).flushSync();

  assert.equal(await db.items.count(), 2);
  assert.ok(await db.items.get(2));
});

test('merge: equal timestamps keep local', async () => {
  await setCreds();
  await seedItem({ name: 'Local' });
  const fake = makeFake();
  fake.files.set(FILE, remoteFile([{
    id: 1, name: 'Remote', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }]));

  await makeSync(fake).flushSync();

  assert.equal((await db.items.get(1)).name, 'Local');
});

test('forcePush: skips merge and pushes local state', async () => {
  await setCreds();
  await seedItem({ name: 'Local' });
  const fake = makeFake();
  fake.files.set(FILE, remoteFile([{
    id: 1, name: 'Remote', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null,
    updatedAt: '2026-02-01T00:00:00.000Z',
  }]));

  const result = await makeSync(fake).flushSync(false, true);

  assert.equal(result.ok, true);
  assert.equal((await db.items.get(1)).name, 'Local');
  assert.equal(fake.files.get(FILE).data.items[0].name, 'Local');
});

// ── testOnly ──

test('testOnly: verifies connection without pushing', async () => {
  await setCreds();
  const fake = makeFake();
  const result = await makeSync(fake).flushSync(true);

  assert.equal(result.ok, true);
  assert.equal(fake.calls.put, 0);
  assert.equal(fake.files.has(FILE), false);
});

test('testOnly: 401 reports authentication failure', async () => {
  await setCreds();
  const fake = makeFake({ getStatus: () => ({ status: 401 }) });
  const result = await makeSync(fake).flushSync(true);

  assert.equal(result.ok, false);
  assert.match(result.message, /Authentication failed/);
});

// ── Error mapping ──

test('401: authentication failure message', async () => {
  await setCreds();
  const fake = makeFake({ getStatus: () => ({ status: 401 }) });
  const result = await makeSync(fake).flushSync();

  assert.equal(result.ok, false);
  assert.match(result.message, /Authentication failed/);
});

test('403 with rate limit: rate-limit message', async () => {
  await setCreds();
  const fake = makeFake({ getStatus: () => ({ status: 403, rateLimited: true }) });
  const result = await makeSync(fake).flushSync();

  assert.equal(result.ok, false);
  assert.match(result.message, /rate limit/i);
});

test('403 without rate limit: access-denied message', async () => {
  await setCreds();
  const fake = makeFake({ getStatus: () => ({ status: 403 }) });
  const result = await makeSync(fake).flushSync();

  assert.equal(result.ok, false);
  assert.match(result.message, /Access denied/);
});

// ── 409 conflict handling ──

test('409: retries and succeeds', async () => {
  await setCreds();
  await seedItem();
  const fake = makeFake({ failPut409: 1 });
  const result = await makeSync(fake).flushSync();

  assert.equal(result.ok, true);
  assert.equal(filePuts(fake).length, 2);
});

test('409: gives up after bounded retries', async () => {
  await setCreds();
  await seedItem();
  const fake = makeFake({ failPut409: 99 });
  const result = await makeSync(fake).flushSync();

  assert.equal(result.ok, false);
  assert.match(result.message, /conflict/i);
  assert.equal(fake.calls.put, 3);
});

test('409: re-merges remote changes before retrying', async () => {
  await setCreds();
  await seedItem({ id: 1, name: 'Mine' });
  const fake = makeFake({
    beforePut: path => {
      if (path === FILE && !fake.files.has(FILE)) {
        fake.files.set(FILE, remoteFile([{
          id: 2, name: 'Theirs', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null,
          updatedAt: '2026-01-02T00:00:00.000Z',
        }]));
      }
    },
  });

  const result = await makeSync(fake).flushSync();

  assert.equal(result.ok, true);
  const names = fake.files.get(FILE).data.items.map(i => i.name).sort();
  assert.deepEqual(names, ['Mine', 'Theirs']);
});

// ── Concurrency ──

test('concurrent syncs coalesce into one round trip', async () => {
  await setCreds();
  await seedItem();
  const fake = makeFake();
  const sync = makeSync(fake);
  const [a, b] = await Promise.all([sync.flushSync(), sync.flushSync()]);

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(fileGets(fake).length, 1);
  assert.equal(filePuts(fake).length, 1);
});

test('restore waits for in-flight sync; final state is the restored data', async () => {
  await setCreds();
  await seedItem({ id: 1, name: 'Before' });

  let releasePut;
  const fake = makeFake({
    hangFirstPut: () => new Promise(r => { releasePut = r; }),
  });
  const sync = makeSync(fake);

  const p1 = sync.flushSync();
  await waitFor(() => fake.calls.put === 1);

  const restored = {
    version: 1,
    stores: [],
    items: [{ id: 2, name: 'After', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-02-01T00:00:00.000Z' }],
    shoppingRuns: [],
    checkedItems: [],
  };
  const p2 = sync.restoreFromData(restored);
  releasePut();

  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  const puts = filePuts(fake);
  assert.equal(puts.length, 2);
  assert.deepEqual(puts[0].data.items.map(i => i.name), ['Before']);

  // The restored row is active; the pre-restore row that was live but not
  // in the backup is archived, not resurrected.
  const finalItems = fake.files.get(FILE).data.items;
  assert.deepEqual(finalItems.map(i => i.name).sort(), ['After', 'Before']);
  assert.equal(finalItems.find(i => i.name === 'After').deletedAt, null);
  assert.ok(finalItems.find(i => i.name === 'Before').deletedAt);
  const localItems = await db.items.toArray();
  assert.equal(localItems.find(i => i.name === 'After').deletedAt, null);
  assert.ok(localItems.find(i => i.name === 'Before').deletedAt);
});

test('restore: live rows not in the backup are archived locally and in the pushed payload', async () => {
  await setCreds();
  const fake = makeFake();
  fake.files.set(FILE, remoteFile([
    { id: 1, name: 'InBackup', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 2, name: 'Extra', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-02-01T00:00:00.000Z' },
  ]));
  fake.files.set(`${BACKUPS}/2026-01-01.json`, {
    sha: 'bk',
    data: {
      version: 1,
      stores: [],
      items: [{ id: 1, name: 'InBackup', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' }],
      shoppingRuns: [],
      checkedItems: [],
    },
  });

  const before = new Date().toISOString();
  const result = await makeSync(fake).restoreBackup('2026-01-01.json');

  assert.equal(result.ok, true);
  assert.equal(await db.items.count(), 2);
  assert.equal((await db.items.get(1)).deletedAt, null);
  const extra = await db.items.get(2);
  assert.ok(extra.deletedAt);
  assert.ok(extra.updatedAt >= before);
  const pushed = fake.files.get(FILE).data.items;
  assert.equal(pushed.length, 2);
  assert.ok(pushed.find(i => i.id === 2).deletedAt);
});

test('restore: stamped rows win LWW against a stale sibling pushing newer pre-restore state', async () => {
  await setCreds();
  await seedItem({ id: 1, name: 'Before', updatedAt: '2026-03-01T00:00:00.000Z' });
  const fake = makeFake();
  fake.files.set(FILE, remoteFile([{
    id: 1, name: 'Before', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null,
    updatedAt: '2026-03-01T00:00:00.000Z',
  }]));
  fake.files.set(`${BACKUPS}/2026-01-01.json`, {
    sha: 'bk',
    data: {
      version: 1,
      stores: [],
      items: [{ id: 1, name: 'Restored', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' }],
      shoppingRuns: [],
      checkedItems: [],
    },
  });

  const before = new Date().toISOString();
  const sync = makeSync(fake);
  const result = await sync.restoreBackup('2026-01-01.json');

  assert.equal(result.ok, true);
  const restored = await db.items.get(1);
  assert.equal(restored.name, 'Restored');
  assert.ok(restored.updatedAt >= before);
  assert.equal(fake.files.get(FILE).data.items[0].name, 'Restored');

  // A stale sibling device pushes its newer pre-restore state.
  fake.files.set(FILE, remoteFile([{
    id: 1, name: 'Before', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null,
    updatedAt: '2026-03-01T00:00:00.000Z',
  }]));

  await sync.flushSync();

  assert.equal((await db.items.get(1)).name, 'Restored');
  assert.equal(fake.files.get(FILE).data.items[0].name, 'Restored');
});

test('restore: network failure after import reports localChanged', async () => {
  await setCreds();
  const fake = makeFake();
  const transport = { ...fake.transport, putFile: async () => { throw new Error('network down'); } };
  const sync = createSync({ makeTransport: () => transport });
  const before = new Date().toISOString();
  const restored = {
    version: 1,
    stores: [],
    items: [{ id: 7, name: 'Restored', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' }],
    shoppingRuns: [],
    checkedItems: [],
  };

  const result = await sync.restoreFromData(restored);

  assert.equal(result.ok, false);
  assert.equal(result.localChanged, true);
  assert.match(result.message, /network down/);
  const items = await db.items.toArray();
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Restored');
  assert.ok(items[0].updatedAt >= before);
});

test('restore: live file fetch failure fails before touching local data', async () => {
  await setCreds();
  await seedItem({ name: 'Keep' });
  const fake = makeFake({ getStatus: () => ({ status: 401 }) });

  const result = await makeSync(fake).restoreFromData({ version: 1, items: [] });

  assert.equal(result.ok, false);
  assert.match(result.message, /Authentication failed/);
  assert.equal(await db.items.count(), 1);
  assert.equal((await db.items.get(1)).name, 'Keep');
  assert.equal(fake.calls.put, 0);
});

test('restoreFromData without credentials fails without touching local data', async () => {
  await seedItem({ name: 'Keep' });
  const fake = makeFake();
  const result = await makeSync(fake).restoreFromData({ version: 1, items: [] });

  assert.equal(result.ok, false);
  assert.match(result.message, /not configured/i);
  assert.equal(await db.items.count(), 1);
  assert.equal((await db.items.get(1)).name, 'Keep');
});

// ── Backups ──

test('daily backup: written on first sync of the day, skipped on later syncs', async () => {
  await setCreds();
  await seedItem();
  const fake = makeFake();
  const sync = makeSync(fake);

  await sync.flushSync();
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(fake.files.has(`${BACKUPS}/${today}.json`));
  assert.equal(await getSyncMeta('lastBackupAt'), today);

  await sync.flushSync();
  const backupPuts = fake.calls.puts.filter(p => p.path.startsWith(BACKUPS));
  assert.equal(backupPuts.length, 1);
});

test('daily backup: prunes to the 10 most recent', async () => {
  await setCreds();
  await seedItem();
  const fake = makeFake();
  const dates = [
    '2026-01-10', '2026-01-19', '2026-02-11', '2026-03-12', '2026-04-13',
    '2026-05-14', '2026-06-15', '2026-07-16', '2026-08-17', '2026-08-28',
  ];
  for (const d of dates) {
    fake.files.set(`${BACKUPS}/${d}.json`, { sha: `b-${d}`, data: { version: 1 } });
  }

  await makeSync(fake).flushSync();

  const backups = [...fake.files.keys()].filter(p => p.startsWith(BACKUPS));
  assert.equal(backups.length, 10);
  assert.ok(!fake.files.has(`${BACKUPS}/2026-01-10.json`));
  assert.ok(fake.files.has(`${BACKUPS}/2026-08-28.json`));
});

test('listBackups: lists backups sorted newest first', async () => {
  await setCreds();
  const fake = makeFake();
  fake.files.set(`${BACKUPS}/2026-01-02.json`, { sha: 'a', data: {} });
  fake.files.set(`${BACKUPS}/2026-01-01.json`, { sha: 'b', data: {} });

  const { ok, backups } = await makeSync(fake).listBackups();

  assert.equal(ok, true);
  assert.deepEqual(backups.map(b => b.filename), ['2026-01-02.json', '2026-01-01.json']);
});

test('restoreBackup: replaces local tables and pushes', async () => {
  await setCreds();
  await seedItem({ id: 1, name: 'Old' });
  const fake = makeFake();
  fake.files.set(`${BACKUPS}/2026-01-01.json`, {
    sha: 'bk',
    data: {
      version: 1,
      stores: [],
      items: [{ id: 9, name: 'FromBackup', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2026-01-01T00:00:00.000Z' }],
      shoppingRuns: [],
      checkedItems: [],
    },
  });

  const result = await makeSync(fake).restoreBackup('2026-01-01.json');

  assert.equal(result.ok, true);
  assert.deepEqual((await db.items.toArray()).map(i => i.name), ['FromBackup']);
  assert.deepEqual(fake.files.get(FILE).data.items.map(i => i.name), ['FromBackup']);
});

// ── State events ──

test('fires happylist:sync-state syncing → ok', async () => {
  const prev = globalThis.window;
  const fired = [];
  globalThis.window = { dispatchEvent: e => fired.push(e) };
  try {
    await setCreds();
    await seedItem();
    await makeSync(makeFake()).flushSync();
    const states = fired
      .filter(e => e.type === 'happylist:sync-state')
      .map(e => e.detail.state);
    assert.deepEqual(states, ['syncing', 'ok']);
  } finally {
    globalThis.window = prev;
  }
});

test('fires happylist:sync-state error on failure', async () => {
  const prev = globalThis.window;
  const fired = [];
  globalThis.window = { dispatchEvent: e => fired.push(e) };
  try {
    await setCreds();
    const fake = makeFake({ getStatus: () => ({ status: 401 }) });
    await makeSync(fake).flushSync();
    const states = fired
      .filter(e => e.type === 'happylist:sync-state')
      .map(e => e.detail.state);
    assert.deepEqual(states, ['syncing', 'error']);
  } finally {
    globalThis.window = prev;
  }
});
