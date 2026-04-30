import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@4/dist/dexie.mjs';

const db = new Dexie('happylist');

db.version(1).stores({
  stores:       '++id, name, sortOrder, updatedAt, deletedAt',
  categories:   '++id, name, sortOrder, updatedAt, deletedAt',
  items:        '++id, name, categoryId, *storeIds, updatedAt, deletedAt',
  shoppingRuns: '++id, storeId, startedAt, completedAt, updatedAt, deletedAt',
  checkedItems: '++id, runId, itemId, checkedAt, updatedAt, deletedAt',
  syncMeta:     '++id, &key',
});

export default db;

export function now() {
  return new Date().toISOString();
}

export async function getSyncMeta(key) {
  const row = await db.syncMeta.where('key').equals(key).first();
  return row ? row.value : null;
}

export async function setSyncMeta(key, value) {
  const row = await db.syncMeta.where('key').equals(key).first();
  if (row) {
    await db.syncMeta.update(row.id, { value });
  } else {
    await db.syncMeta.add({ key, value });
  }
}
