import { isActive, isInactive } from '../data.js';

const byName = (a, b) => a.name.localeCompare(b.name);

// Pure: given the full (unfiltered) item set, the stores, and the current view
// state, compute exactly what the list view shows. No DOM, no globals.
// selectedStoreIds is the store filter: a set of stores; empty = All.
// Matching is union — an item shows if it belongs to any selected store.
export function computeListView({ items, stores, selectedStoreIds = [], searchQuery = '' }) {
  const q = String(searchQuery).trim().toLowerCase();
  const selected = new Set(selectedStoreIds);

  const matchesFilter = item => {
    if (selected.size && !(item.storeIds || []).some(sid => selected.has(sid))) return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  };

  const active = items.filter(i => isActive(i) && matchesFilter(i)).sort(byName);
  const inactive = items.filter(i => isInactive(i) && matchesFilter(i)).sort(byName);

  const empty = (!active.length && !inactive.length)
    ? (items.length ? 'no-match' : 'no-items')
    : null;

  const filters = [
    { label: 'All', storeId: null, colour: null, active: selected.size === 0 },
    ...stores.map(s => ({ label: s.name, storeId: s.id, colour: s.colour, active: selected.has(s.id) })),
  ];

  return { filters, active, inactive, empty };
}
