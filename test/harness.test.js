import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import db from '../js/db.js';

test('Dexie opens against fake-indexeddb and round-trips a row', async () => {
  await db.open();
  const id = await db.stores.add({
    name: 'Test Store',
    colour: '#2563eb',
    sortOrder: 0,
    deletedAt: null,
    updatedAt: new Date().toISOString(),
  });
  const store = await db.stores.get(id);
  assert.equal(store.name, 'Test Store');
  await db.stores.clear();
});
