import db, { now } from './db.js';

// ── Status predicates ──

export function isArchived(item) {
  return !!item.deletedAt;
}

export function isBought(item) {
  return !!item.boughtAt;
}

export function isRemoved(item) {
  return !!item.removedAt;
}

export function isActive(item) {
  return !isArchived(item) && !isBought(item) && !isRemoved(item);
}

export function isInactive(item) {
  return !isArchived(item) && (isBought(item) || isRemoved(item));
}

// Associated with a store — includes bought items (the stores tab's "N items")
export function isAssociated(item) {
  return !isArchived(item) && !isRemoved(item);
}

// Per-store counts for a given item set (the shop grid and stores tab feed this with different sets)
export function storeCounts(items) {
  const counts = {};
  for (const item of items) {
    for (const sid of item.storeIds ?? []) {
      counts[sid] = (counts[sid] ?? 0) + 1;
    }
  }
  return counts;
}

// ── Write path (local user mutations: stamp + fire) ──

function fireMutated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('happylist:mutated'));
  }
}

export async function mutateRow(table, id, patch) {
  await db[table].update(id, { ...patch, updatedAt: now() });
  fireMutated();
}

export async function addRow(table, row) {
  const key = await db[table].add({ deletedAt: null, ...row, updatedAt: now() });
  fireMutated();
  return key;
}

export async function softDelete(table, id) {
  await db[table].update(id, { deletedAt: now(), updatedAt: now() });
  fireMutated();
}

// ── Item domain operations ──

export async function upsertItem(id, fields) {
  if (id) {
    await mutateRow('items', id, fields);
  } else {
    await addRow('items', { boughtAt: null, removedAt: null, ...fields });
  }
}

// Refuses removed items — the structural backstop for "removed is never bought"
export async function buyItem(id) {
  const item = await db.items.get(id);
  if (!item || isRemoved(item)) return false;
  await mutateRow('items', id, { boughtAt: now() });
  return true;
}

export async function removeFromList(id) {
  await mutateRow('items', id, { removedAt: now(), boughtAt: null });
}

export async function reactivateItem(id) {
  const item = await db.items.get(id);
  if (!item) return;
  const patch = {};
  if (isBought(item)) patch.boughtAt = null;
  if (isRemoved(item)) patch.removedAt = null;
  if (Object.keys(patch).length === 0) return;
  await mutateRow('items', id, patch);
}

// ── Import mode (sync / restore: as-is, no stamp, no fire) ──

export async function importTable(table, rows) {
  await db[table].clear();
  if (rows?.length) await db[table].bulkPut(rows);
}

export async function putRowAsIs(table, row) {
  await db[table].put(row);
}
