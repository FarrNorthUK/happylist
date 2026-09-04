import { storeBg } from '../dom.js';
import { hasCard } from '../card.js';

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
