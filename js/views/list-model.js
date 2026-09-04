import { isActive, isInactive } from '../data.js';

const byName = (a, b) => a.name.localeCompare(b.name);

// Pure: given the full (unfiltered) item set, the stores, and the current view
// state, compute exactly what the list view shows. No DOM, no globals.
export function computeListView({ items, stores, activeStoreFilter = null, searchQuery = '' }) {
  const q = String(searchQuery).trim().toLowerCase();

  const matchesFilter = item => {
    if (activeStoreFilter !== null && !(item.storeIds || []).includes(activeStoreFilter)) return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  };

  const active = items.filter(i => isActive(i) && matchesFilter(i)).sort(byName);
  const inactive = items.filter(i => isInactive(i) && matchesFilter(i)).sort(byName);

  const empty = (!active.length && !inactive.length)
    ? (items.length ? 'no-match' : 'no-items')
    : null;

  const filters = [
    { label: 'All', storeId: null, colour: null, active: activeStoreFilter === null },
    ...stores.map(s => ({ label: s.name, storeId: s.id, colour: s.colour, active: activeStoreFilter === s.id })),
  ];

  return { filters, active, inactive, empty };
}
