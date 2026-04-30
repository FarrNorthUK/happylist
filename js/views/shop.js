import db, { now } from '../db.js';
import { liveQuery } from 'https://cdn.jsdelivr.net/npm/dexie@4/dist/dexie.mjs';
import { showConfirm } from '../confirm.js';
import { showBarcode } from './stores.js';

let currentRunId = null;
let currentStoreId = null;
let _currentStore = null;
let subscription = null;

export function initShop() {
  renderStoreGrid();
  document.getElementById('btn-finish-trip').onclick = finishTrip;
  document.getElementById('btn-show-card').onclick = () => {
    if (_currentStore) showBarcode(_currentStore);
  };
}

export function resetShopToGrid() {
  if (!currentRunId) showGrid();
}

function storeBg(store) {
  return store.colour2
    ? `linear-gradient(135deg, ${store.colour} 50%, ${store.colour2} 50%)`
    : store.colour;
}

async function renderStoreGrid() {
  const stores = await db.stores.filter(s => !s.deletedAt).sortBy('sortOrder');
  const grid = document.getElementById('shop-store-grid');

  if (!stores.length) {
    grid.innerHTML = '<p class="empty-state">Add stores in the Stores tab first.</p>';
    return;
  }

  // Count only active (not bought) items per store
  const items = await db.items.filter(i => !i.deletedAt && !i.boughtAt).toArray();
  const counts = {};
  items.forEach(item => (item.storeIds || []).forEach(sid => { counts[sid] = (counts[sid] ?? 0) + 1; }));

  grid.innerHTML = '';
  stores.forEach(store => {
    const card = document.createElement('div');
    card.className = 'store-card';
    card.style.background = storeBg(store);
    card.innerHTML = `
      <span>${esc(store.name)}</span>
      <span class="store-card-count">${counts[store.id] ?? 0} items</span>`;
    card.onclick = () => startRun(store);
    grid.appendChild(card);
  });
}

function showGrid() {
  currentRunId = null;
  currentStoreId = null;
  _currentStore = null;
  document.getElementById('shop-title').textContent = 'Shop';
  document.getElementById('btn-finish-trip').classList.add('hidden');
  document.getElementById('btn-show-card').classList.add('hidden');
  document.getElementById('shop-run-view').classList.add('hidden');
  document.getElementById('shop-store-grid').classList.remove('hidden');
  subscription?.unsubscribe();
  subscription = null;
  renderStoreGrid();
}

async function startRun(store) {
  currentStoreId = store.id;
  _currentStore = store;

  let run = await db.shoppingRuns
    .filter(r => r.storeId === store.id && !r.completedAt && !r.deletedAt)
    .first();

  if (!run) {
    const id = await db.shoppingRuns.add({
      storeId: store.id,
      startedAt: now(),
      completedAt: null,
      updatedAt: now(),
      deletedAt: null,
    });
    run = await db.shoppingRuns.get(id);
  }

  currentRunId = run.id;
  document.getElementById('shop-title').textContent = store.name;
  document.getElementById('btn-finish-trip').classList.remove('hidden');
  document.getElementById('btn-show-card').classList.toggle('hidden', !store.cardNumber);
  document.getElementById('shop-store-grid').classList.add('hidden');
  document.getElementById('shop-run-view').classList.remove('hidden');

  subscribeToRun();
}

function subscribeToRun() {
  subscription?.unsubscribe();
  subscription = liveQuery(async () => {
    const [items, categories, checkedNow] = await Promise.all([
      // Exclude bought items from the shop checklist
      db.items.filter(i => !i.deletedAt && !i.boughtAt && (i.storeIds || []).includes(currentStoreId)).toArray(),
      db.categories.filter(c => !c.deletedAt).sortBy('sortOrder'),
      db.checkedItems.filter(ci => ci.runId === currentRunId && !ci.deletedAt).toArray(),
    ]);
    return { items, categories, checkedNow };
  }).subscribe({ next: renderRunView, error: console.error });
}

function renderRunView({ items, categories, checkedNow }) {
  const checkedSet = new Set(checkedNow.map(ci => ci.itemId));
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));

  const groups = {};
  const UNCATEGORISED = '__none__';
  items.forEach(item => {
    const key = item.categoryId ? String(item.categoryId) : UNCATEGORISED;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  const sortedKeys = categories
    .filter(c => groups[String(c.id)])
    .map(c => String(c.id));
  if (groups[UNCATEGORISED]) sortedKeys.push(UNCATEGORISED);

  const ul = document.getElementById('shop-checklist');
  ul.innerHTML = '';

  if (!items.length) {
    ul.innerHTML = '<li class="empty-state">No items to get from this store.</li>';
    return;
  }

  sortedKeys.forEach(key => {
    const groupItems = groups[key];
    const catName = key === UNCATEGORISED ? 'Other' : (catMap[Number(key)]?.name ?? 'Other');

    const header = document.createElement('li');
    header.className = 'checklist-group-header';
    header.textContent = catName;
    ul.appendChild(header);

    groupItems.forEach(item => {
      const isChecked = checkedSet.has(item.id);
      const li = document.createElement('li');
      li.className = 'check-row' + (isChecked ? ' checked' : '');
      li.dataset.itemId = item.id;
      const meta = [item.quantity, item.unit].filter(Boolean).join(' ');
      li.innerHTML = `
        <span class="check-box">${isChecked ? '✓' : ''}</span>
        <span class="item-main">
          <span class="check-name">${esc(item.name)}</span>
          ${meta ? `<div class="check-qty">${esc(meta)}</div>` : ''}
        </span>`;
      li.onclick = () => toggleCheck(item.id, isChecked);
      ul.appendChild(li);
    });
  });
}

async function toggleCheck(itemId, currentlyChecked) {
  if (currentlyChecked) {
    const ci = await db.checkedItems.filter(c => c.runId === currentRunId && c.itemId === itemId && !c.deletedAt).first();
    if (ci) {
      await db.checkedItems.update(ci.id, { deletedAt: now(), updatedAt: now() });
      triggerSyncSoon();
    }
  } else {
    await db.checkedItems.add({
      runId: currentRunId,
      itemId,
      checkedAt: now(),
      updatedAt: now(),
      deletedAt: null,
    });
    triggerSyncSoon();
  }
}

async function finishTrip() {
  if (!currentRunId) return;
  const t = now();

  const checkedNow = await db.checkedItems
    .filter(ci => ci.runId === currentRunId && !ci.deletedAt)
    .toArray();

  let itemsSaved = false;
  if (checkedNow.length > 0) {
    const save = await showConfirm(
      `Save ${checkedNow.length} checked item${checkedNow.length !== 1 ? 's' : ''} as purchased?`,
      { confirmText: 'Save' }
    );
    if (!save) return;
    await Promise.all(checkedNow.map(ci =>
      db.items.update(ci.itemId, { boughtAt: t, updatedAt: t })
    ));
    itemsSaved = true;
  }

  await db.shoppingRuns.update(currentRunId, { completedAt: t, updatedAt: t });
  if (itemsSaved) triggerSyncSoon();
  showGrid();
}

function triggerSyncSoon() {
  window.dispatchEvent(new CustomEvent('happylist:mutated'));
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
