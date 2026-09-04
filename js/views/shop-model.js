import { isActive, isBought, isRemoved } from '../data.js';
import { storeBg } from '../dom.js';

const byName = (a, b) => a.name.localeCompare(b.name);

// Pure: split a store's items into the run view's sections.
export function computeRunView({ allStoreItems, checkedNow }) {
  const checkedSet = new Set(checkedNow.map(ci => ci.itemId));

  const wanted = allStoreItems
    .filter(i => isActive(i) && !checkedSet.has(i.id))
    .sort(byName);

  const ticked = allStoreItems
    .filter(i => checkedSet.has(i.id) && !isRemoved(i))
    .sort(byName);

  const inactive = allStoreItems
    .filter(i => (isBought(i) && !isRemoved(i) && !checkedSet.has(i.id)) || isRemoved(i))
    .sort(byName);

  const empty = !wanted.length && !ticked.length && !inactive.length;

  return { wanted, ticked, inactive, empty };
}

// Pure: per-store cards for the shop grid.
export function computeShopGrid({ stores, counts }) {
  const cards = stores.map(s => ({
    id: s.id,
    name: s.name,
    count: counts[s.id] ?? 0,
    bg: storeBg(s),
  }));
  return { cards, empty: !stores.length };
}
