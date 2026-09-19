import { storeBg } from '../dom.js';
import { hasCard } from '../card.js';

// Pure: confirmation message for deleting a store.
export function computeDeleteStoreMessage({ storeName, linkedItems }) {
  let message = `Delete "${storeName}"?`;
  const n = linkedItems.length;
  if (n) {
    message += ` ${n} item${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} linked to it.`;
    const onlyLinked = linkedItems.filter(i => (i.storeIds || []).length === 1).length;
    if (onlyLinked) message += ` ${onlyLinked} will be moved to General.`;
  }
  return message;
}

// Pure: rows for the stores list (display values only; the DOM layer attaches handlers).
export function computeStoreList({ stores, itemCounts }) {
  const rows = stores.map((store, idx) => ({
    id: store.id,
    name: store.name,
    count: itemCounts[store.id] ?? 0,
    bg: storeBg(store),
    hasCard: hasCard(store),
    canUp: idx > 0,
    canDown: idx < stores.length - 1,
  }));
  return { rows, empty: !stores.length };
}
