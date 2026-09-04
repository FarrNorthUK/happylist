import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import db from '../js/db.js';
import * as data from '../js/data.js';

const fired = [];
globalThis.window = { dispatchEvent: (e) => fired.push(e.type) };

const OLD_TS = '2020-01-01T00:00:00.000Z';

async function seedItem(overrides = {}) {
  return db.items.add({
    name: 'Item',
    storeIds: [],
    boughtAt: null,
    removedAt: null,
    deletedAt: null,
    updatedAt: OLD_TS,
    ...overrides,
  });
}

beforeEach(async () => {
  fired.length = 0;
  await Promise.all([
    db.items.clear(),
    db.stores.clear(),
    db.shoppingRuns.clear(),
    db.checkedItems.clear(),
  ]);
});

test('predicates: item states', () => {
  const active = { boughtAt: null, removedAt: null, deletedAt: null };
  const bought = { boughtAt: OLD_TS, removedAt: null, deletedAt: null };
  const removed = { boughtAt: null, removedAt: OLD_TS, deletedAt: null };
  const archived = { boughtAt: null, removedAt: null, deletedAt: OLD_TS };

  assert.ok(data.isActive(active));
  assert.ok(!data.isActive(bought));
  assert.ok(!data.isActive(removed));
  assert.ok(!data.isActive(archived));

  assert.ok(data.isInactive(bought));
  assert.ok(data.isInactive(removed));
  assert.ok(!data.isInactive(active));
  assert.ok(!data.isInactive(archived));

  assert.ok(data.isAssociated(bought));
  assert.ok(!data.isAssociated(removed));
  assert.ok(!data.isAssociated(archived));
});

test('storeCounts: to-buy set vs associated set', () => {
  const items = [
    { id: 1, storeIds: [1, 2], boughtAt: null, removedAt: null, deletedAt: null },
    { id: 2, storeIds: [1], boughtAt: OLD_TS, removedAt: null, deletedAt: null },
    { id: 3, storeIds: [1], boughtAt: null, removedAt: OLD_TS, deletedAt: null },
  ];

  assert.deepEqual(data.storeCounts(items.filter(data.isActive)), { 1: 1, 2: 1 });
  assert.deepEqual(data.storeCounts(items.filter(data.isAssociated)), { 1: 2, 2: 1 });
});

test('upsertItem: adds with default state fields, stamps, fires', async () => {
  const before = new Date().toISOString();
  await data.upsertItem(null, { name: 'Milk', quantity: 2, unit: 'L', notes: null, storeIds: [1] });

  const item = await db.items.orderBy('id').first();
  assert.equal(item.name, 'Milk');
  assert.equal(item.boughtAt, null);
  assert.equal(item.removedAt, null);
  assert.equal(item.deletedAt, null);
  assert.ok(item.updatedAt >= before);
  assert.deepEqual(fired, ['happylist:mutated']);
});

test('upsertItem: updates an existing item', async () => {
  const id = await seedItem({ name: 'Eggs' });
  await data.upsertItem(id, { name: 'Eggs', quantity: 12, unit: null, notes: null, storeIds: [3] });

  const item = await db.items.get(id);
  assert.equal(item.quantity, 12);
  assert.ok(item.updatedAt > OLD_TS);
  assert.deepEqual(fired, ['happylist:mutated']);
});

test('buyItem: marks bought, refuses removed items', async () => {
  const a = await seedItem({ name: 'A' });
  const b = await seedItem({ name: 'B', removedAt: OLD_TS });

  assert.equal(await data.buyItem(a), true);
  assert.ok((await db.items.get(a)).boughtAt);

  assert.equal(await data.buyItem(b), false);
  assert.equal((await db.items.get(b)).boughtAt, null);
  assert.deepEqual(fired, ['happylist:mutated']);
});

test('removeFromList: sets removed, clears bought', async () => {
  const id = await seedItem({ boughtAt: OLD_TS });
  await data.removeFromList(id);

  const item = await db.items.get(id);
  assert.ok(item.removedAt);
  assert.equal(item.boughtAt, null);
  assert.deepEqual(fired, ['happylist:mutated']);
});

test('reactivateItem: clears bought, removed, or both', async () => {
  const a = await seedItem({ boughtAt: OLD_TS });
  const b = await seedItem({ removedAt: OLD_TS });
  const c = await seedItem({ boughtAt: OLD_TS, removedAt: OLD_TS });

  await data.reactivateItem(a);
  await data.reactivateItem(b);
  await data.reactivateItem(c);

  assert.ok(data.isActive(await db.items.get(a)));
  assert.ok(data.isActive(await db.items.get(b)));
  assert.ok(data.isActive(await db.items.get(c)));
  assert.equal(fired.length, 3);
});

test('mutateRow / addRow / softDelete: stamp and fire', async () => {
  const id = await data.addRow('stores', {
    name: 'Store A', colour: '#fff', sortOrder: 0,
    colour2: null, cardNumber: null, cardFormat: null, cardImage: null,
  });
  const added = await db.stores.get(id);
  assert.equal(added.deletedAt, null);
  assert.ok(added.updatedAt > OLD_TS);

  await data.mutateRow('stores', id, { name: 'Store B' });
  assert.equal((await db.stores.get(id)).name, 'Store B');

  await data.softDelete('stores', id);
  assert.ok((await db.stores.get(id)).deletedAt);

  assert.deepEqual(fired, ['happylist:mutated', 'happylist:mutated', 'happylist:mutated']);
});

test('importTable: replaces rows as-is, no stamp, no fire', async () => {
  await seedItem({ name: 'Old' });
  await data.importTable('items', [
    { id: 100, name: 'Imported', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2024-06-01T00:00:00.000Z' },
  ]);

  const rows = await db.items.toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 100);
  assert.equal(rows[0].updatedAt, '2024-06-01T00:00:00.000Z');
  assert.deepEqual(fired, []);
});

test('putRowAsIs: writes a row without stamping or firing', async () => {
  await data.putRowAsIs('items', {
    id: 200, name: 'Merged', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2024-06-01T00:00:00.000Z',
  });

  assert.equal((await db.items.get(200)).updatedAt, '2024-06-01T00:00:00.000Z');
  assert.deepEqual(fired, []);
});
