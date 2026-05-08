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
    const [allStoreItems, checkedNow] = await Promise.all([
      db.items.filter(i => !i.deletedAt && (i.storeIds || []).includes(currentStoreId)).toArray(),
      db.checkedItems.filter(ci => ci.runId === currentRunId && !ci.deletedAt).toArray(),
    ]);
    return { allStoreItems, checkedNow };
  }).subscribe({ next: renderRunView, error: console.error });
}

function renderRunView({ allStoreItems, checkedNow }) {
  const checkedSet = new Set(checkedNow.map(ci => ci.itemId));

  const wanted = allStoreItems
    .filter(i => !i.boughtAt && !checkedSet.has(i.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const ticked = allStoreItems
    .filter(i => checkedSet.has(i.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const prevBought = allStoreItems
    .filter(i => i.boughtAt && !checkedSet.has(i.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const ul = document.getElementById('shop-checklist');
  ul.textContent = '';

  if (!wanted.length && !ticked.length && !prevBought.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No items for this store.';
    ul.appendChild(li);
    return;
  }

  wanted.forEach(item => ul.appendChild(makeRunRow(item, 'wanted')));

  if (ticked.length) {
    ul.appendChild(makeDivider('— ticked off this run —', false));
    ticked.forEach(item => ul.appendChild(makeRunRow(item, 'ticked')));
  }

  if (prevBought.length) {
    ul.appendChild(makeDivider('— previously bought — tap to re-add —', true));
    prevBought.forEach(item => ul.appendChild(makeRunRow(item, 'prev')));
  }
}

function makeDivider(text, muted) {
  const li = document.createElement('li');
  li.className = 'run-divider' + (muted ? ' run-divider--muted' : '');
  li.textContent = text;
  return li;
}

function makeRunRow(item, section) {
  const li = document.createElement('li');
  const meta = [item.quantity, item.unit].filter(Boolean).join(' ');

  const main = document.createElement('div');
  main.className = 'item-main';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'item-name';
  nameSpan.textContent = item.name;
  main.appendChild(nameSpan);

  if (meta) {
    const metaDiv = document.createElement('div');
    metaDiv.className = 'item-meta';
    metaDiv.textContent = meta;
    main.appendChild(metaDiv);
  }

  li.appendChild(main);

  if (section === 'prev') {
    li.className = 'item-row item-row--bought';
    li.onclick = async () => {
      const ok = await showConfirm(`Add "${item.name}" back to your list?`, { confirmText: 'Add to list' });
      if (ok) {
        await db.items.update(item.id, { boughtAt: null, updatedAt: now() });
        triggerSyncSoon();
      }
    };
  } else if (section === 'ticked') {
    li.className = 'item-row item-row--bought';
    const check = document.createElement('div');
    check.className = 'run-check run-check--checked';
    check.textContent = '✓';
    li.appendChild(check);
    li.onclick = () => toggleCheck(item.id, true);
  } else {
    li.className = 'item-row';
    const check = document.createElement('div');
    check.className = 'run-check';
    li.appendChild(check);
    li.onclick = () => toggleCheck(item.id, false);
  }

  return li;
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
    const result = await showConfirm(
      `You have ${checkedNow.length} ticked item${checkedNow.length !== 1 ? 's' : ''}. Save as purchased before leaving?`,
      { confirmText: 'Save & Leave', thirdText: 'Leave without saving' }
    );
    if (result === false) return;
    if (result === true) {
      await Promise.all(checkedNow.map(ci =>
        db.items.update(ci.itemId, { boughtAt: t, updatedAt: t })
      ));
      itemsSaved = true;
    }
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
