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

test('importTableAsLatest: replaces rows stamped as latest, no fire', async () => {
  const before = new Date().toISOString();
  await seedItem({ name: 'Old' });
  await data.importTableAsLatest('items', [
    { id: 100, name: 'Restored', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2024-06-01T00:00:00.000Z' },
  ]);

  const rows = await db.items.toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 100);
  assert.equal(rows[0].name, 'Restored');
  assert.ok(rows[0].updatedAt >= before);
  assert.deepEqual(fired, []);
});

test('putRowAsIs: writes a row without stamping or firing', async () => {
  await data.putRowAsIs('items', {
    id: 200, name: 'Merged', storeIds: [], boughtAt: null, removedAt: null, deletedAt: null, updatedAt: '2024-06-01T00:00:00.000Z',
  });

  assert.equal((await db.items.get(200)).updatedAt, '2024-06-01T00:00:00.000Z');
  assert.deepEqual(fired, []);
});

async function seedStore(overrides = {}) {
  return data.addRow('stores', {
    name: 'Store',
    colour: '#fff',
    colour2: null,
    sortOrder: 0,
    cardNumber: null,
    cardFormat: null,
    cardImage: null,
    ...overrides,
  });
}

test('ensureGeneralStore: creates a flagged General store when none exists', async () => {
  const id = await data.ensureGeneralStore();

  const store = await db.stores.get(id);
  assert.equal(store.name, 'General');
  assert.equal(store.general, true);
  assert.equal(store.deletedAt, null);
  assert.equal(store.sortOrder, 0);
  assert.ok(store.colour);
  assert.deepEqual(fired, ['happylist:mutated']);
});

test('ensureGeneralStore: repurposes an existing store named General, case-insensitively, canonicalising the name', async () => {
  const id = await seedStore({ name: '  gEnErAl ' });

  const generalId = await data.ensureGeneralStore();

  assert.equal(generalId, id);
  const store = await db.stores.get(id);
  assert.equal(store.name, 'General');
  assert.equal(store.general, true);
  assert.equal((await db.stores.count()), 1);
});

test('ensureGeneralStore: repurposes the first General-named store by sortOrder when several exist', async () => {
  const later = await seedStore({ name: 'General', sortOrder: 5 });
  const first = await seedStore({ name: 'GENERAL', sortOrder: 1 });

  const generalId = await data.ensureGeneralStore();

  assert.equal(generalId, first);
  assert.equal((await db.stores.get(first)).general, true);
  assert.notEqual((await db.stores.get(later)).general, true);
});

test('ensureGeneralStore: ignores an archived store named General and creates a new one', async () => {
  await seedStore({ name: 'General', deletedAt: OLD_TS });

  const generalId = await data.ensureGeneralStore();

  const store = await db.stores.get(generalId);
  assert.equal(store.deletedAt, null);
  assert.equal(store.general, true);
  assert.equal((await db.stores.count()), 2);
});

test('ensureGeneralStore: is a no-op on the second call', async () => {
  const id = await data.ensureGeneralStore();
  fired.length = 0;

  await data.ensureGeneralStore();

  assert.equal((await db.stores.count()), 1);
  assert.deepEqual(fired, []);
});

test('ensureGeneralStore: links orphaned non-archived items to General, leaves archived and linked items alone', async () => {
  const active = await seedItem({ name: 'A' });
  const bought = await seedItem({ name: 'B', boughtAt: OLD_TS });
  const removed = await seedItem({ name: 'C', removedAt: OLD_TS });
  const archived = await seedItem({ name: 'D', deletedAt: OLD_TS });
  const linked = await seedItem({ name: 'E', storeIds: [7] });

  const generalId = await data.ensureGeneralStore();

  assert.deepEqual((await db.items.get(active)).storeIds, [generalId]);
  assert.deepEqual((await db.items.get(bought)).storeIds, [generalId]);
  assert.deepEqual((await db.items.get(removed)).storeIds, [generalId]);
  assert.deepEqual((await db.items.get(archived)).storeIds, []);
  assert.deepEqual((await db.items.get(linked)).storeIds, [7]);
});

test('deleteStore: soft-deletes the store, reassigns only-linked items to General, strips multi-store links', async () => {
  const generalId = await data.ensureGeneralStore();
  const storeId = await seedStore({ name: 'Tesco', sortOrder: 1 });
  const onlyLinked = await seedItem({ name: 'A', storeIds: [storeId] });
  const removedOnlyLinked = await seedItem({ name: 'B', storeIds: [storeId], removedAt: OLD_TS });
  const multiLinked = await seedItem({ name: 'C', storeIds: [storeId, 99] });
  const archivedLinked = await seedItem({ name: 'D', storeIds: [storeId], deletedAt: OLD_TS });
  const other = await seedItem({ name: 'E', storeIds: [99] });

  assert.equal(await data.deleteStore(storeId), true);

  assert.ok((await db.stores.get(storeId)).deletedAt);
  assert.deepEqual((await db.items.get(onlyLinked)).storeIds, [generalId]);
  assert.deepEqual((await db.items.get(removedOnlyLinked)).storeIds, [generalId]);
  assert.deepEqual((await db.items.get(multiLinked)).storeIds, [99]);
  assert.deepEqual((await db.items.get(archivedLinked)).storeIds, [storeId]);
  assert.deepEqual((await db.items.get(other)).storeIds, [99]);
});

test('deleteStore: deletes a store with no linked items', async () => {
  await data.ensureGeneralStore();
  const storeId = await seedStore({ name: 'Empty', sortOrder: 1 });

  assert.equal(await data.deleteStore(storeId), true);

  assert.ok((await db.stores.get(storeId)).deletedAt);
});

test('deleteStore: refuses to delete the General store', async () => {
  const generalId = await data.ensureGeneralStore();
  const item = await seedItem({ name: 'A', storeIds: [generalId] });

  assert.equal(await data.deleteStore(generalId), false);

  assert.equal((await db.stores.get(generalId)).deletedAt, null);
  assert.deepEqual((await db.items.get(item)).storeIds, [generalId]);
});

test('deleteStore: refuses a missing store', async () => {
  assert.equal(await data.deleteStore(12345), false);
});

test('upsertItem: assigns General when saved with no stores', async () => {
  const generalId = await data.ensureGeneralStore();

  await data.upsertItem(null, { name: 'Milk', quantity: null, unit: null, notes: null, storeIds: [] });

  assert.deepEqual((await db.items.orderBy('id').first()).storeIds, [generalId]);
});

test('upsertItem: creates General on demand when missing', async () => {
  await data.upsertItem(null, { name: 'Milk', quantity: null, unit: null, notes: null, storeIds: [] });

  const general = await data.getGeneralStore();
  assert.ok(general);
  assert.deepEqual((await db.items.orderBy('id').first()).storeIds, [general.id]);
});

test('upsertItem: keeps explicit store links', async () => {
  await data.ensureGeneralStore();

  await data.upsertItem(null, { name: 'Milk', quantity: null, unit: null, notes: null, storeIds: [7] });

  assert.deepEqual((await db.items.orderBy('id').first()).storeIds, [7]);
});

test('upsertItem: update with no selected stores falls back to General', async () => {
  const generalId = await data.ensureGeneralStore();
  const id = await seedItem({ name: 'Eggs', storeIds: [7] });

  await data.upsertItem(id, { name: 'Eggs', quantity: null, unit: null, notes: null, storeIds: [] });

  assert.deepEqual((await db.items.get(id)).storeIds, [generalId]);
});

test('upsertItem: update without storeIds in the patch leaves existing links untouched', async () => {
  const id = await seedItem({ name: 'Eggs', storeIds: [7] });

  await data.upsertItem(id, { name: 'Eggs', quantity: 6, unit: null, notes: null });

  assert.deepEqual((await db.items.get(id)).storeIds, [7]);
});

test('ensureGeneralStore: concurrent calls coalesce into a single store', async () => {
  const [a, b] = await Promise.all([data.ensureGeneralStore(), data.ensureGeneralStore()]);

  assert.equal(a, b);
  assert.equal((await db.stores.count()), 1);
});
