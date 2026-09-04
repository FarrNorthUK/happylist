import db, { now } from '../db.js';
import { liveQuery } from 'dexie';
import { showConfirm } from '../confirm.js';
import { hasCard, showCardOverlay } from '../card.js';
import {
  isArchived, isRemoved, isActive, storeCounts,
  addRow, mutateRow, softDelete, buyItem, reactivateItem,
} from '../data.js';
import { computeRunView, computeShopGrid } from './shop-model.js';
import { esc } from '../dom.js';

let currentRunId = null;
let currentStoreId = null;
let _currentStore = null;
let subscription = null;

export function initShop() {
  renderStoreGrid();
  document.getElementById('btn-finish-trip').onclick = finishTrip;
  document.getElementById('btn-show-card').onclick = () => {
    if (_currentStore) showCardOverlay(_currentStore);
  };
}

export function resetShopToGrid() {
  if (!currentRunId) showGrid();
}

async function renderStoreGrid() {
  const stores = await db.stores.filter(s => !isArchived(s)).sortBy('sortOrder');
  // Count only active (not bought, not removed) items per store
  const items = await db.items.filter(isActive).toArray();
  const vm = computeShopGrid({ stores, counts: storeCounts(items) });
  renderGrid(vm, Object.fromEntries(stores.map(s => [s.id, s])));
}

function renderGrid(vm, storeById) {
  const grid = document.getElementById('shop-store-grid');
  if (vm.empty) {
    grid.innerHTML = '<p class="empty-state">Add stores in the Stores tab first.</p>';
    return;
  }

  grid.innerHTML = '';
  vm.cards.forEach(card => {
    const el = document.createElement('div');
    el.className = 'store-card';
    el.style.background = card.bg;
    el.innerHTML = `
      <span>${esc(card.name)}</span>
      <span class="store-card-count">${card.count} items</span>`;
    el.onclick = () => startRun(storeById[card.id]);
    grid.appendChild(el);
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
    .filter(r => r.storeId === store.id && !r.completedAt && !isArchived(r))
    .first();

  if (!run) {
    const id = await addRow('shoppingRuns', { storeId: store.id, startedAt: now(), completedAt: null });
    run = await db.shoppingRuns.get(id);
  }

  currentRunId = run.id;
  document.getElementById('shop-title').textContent = store.name;
  document.getElementById('btn-finish-trip').classList.remove('hidden');
  document.getElementById('btn-show-card').classList.toggle('hidden', !hasCard(store));
  document.getElementById('shop-store-grid').classList.add('hidden');
  document.getElementById('shop-run-view').classList.remove('hidden');

  subscribeToRun();
}

function subscribeToRun() {
  subscription?.unsubscribe();
  subscription = liveQuery(async () => {
    const [allStoreItems, checkedNow] = await Promise.all([
      db.items.filter(i => !isArchived(i) && (i.storeIds || []).includes(currentStoreId)).toArray(),
      db.checkedItems.filter(ci => ci.runId === currentRunId && !isArchived(ci)).toArray(),
    ]);
    return { allStoreItems, checkedNow };
  }).subscribe({ next: renderRunView, error: console.error });
}

function renderRunView(data) {
  const vm = computeRunView(data);
  const ul = document.getElementById('shop-checklist');
  ul.textContent = '';

  if (vm.empty) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No items for this store.';
    ul.appendChild(li);
    return;
  }

  vm.wanted.forEach(item => ul.appendChild(makeRunRow(item, 'wanted')));

  if (vm.ticked.length) {
    ul.appendChild(makeDivider('— ticked off this run —', false));
    vm.ticked.forEach(item => ul.appendChild(makeRunRow(item, 'ticked')));
  }

  if (vm.inactive.length) {
    ul.appendChild(makeDivider('— off the list — tap to re-add —', true));
    vm.inactive.forEach(item => ul.appendChild(makeRunRow(item, 'inactive')));
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

  const main = document.createElement('div');
  main.className = 'item-main';

  const nameRow = document.createElement('div');
  nameRow.className = 'item-name-row';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'item-name';
  nameSpan.textContent = item.name;
  nameRow.appendChild(nameSpan);

  if (item.quantity) {
    const qtySpan = document.createElement('span');
    qtySpan.className = 'item-inline-tag';
    qtySpan.textContent = `(Qty ${item.quantity})`;
    nameRow.appendChild(qtySpan);
  }

  if (item.unit) {
    const unitSpan = document.createElement('span');
    unitSpan.className = 'item-inline-tag';
    unitSpan.textContent = `(Size ${item.unit})`;
    nameRow.appendChild(unitSpan);
  }

  main.appendChild(nameRow);

  if (item.notes) {
    const notesDiv = document.createElement('div');
    notesDiv.className = 'item-notes';
    notesDiv.textContent = item.notes;
    main.appendChild(notesDiv);
  }

  li.appendChild(main);

  if (section === 'inactive') {
    li.className = 'item-row';
    li.onclick = async () => {
      const ok = await showConfirm(`Add "${item.name}" back to your list?`, { confirmText: 'Add to list' });
      if (ok) await reactivateItem(item.id);
    };
  } else if (section === 'ticked') {
    li.className = 'item-row';
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
    const ci = await db.checkedItems.filter(c => c.runId === currentRunId && c.itemId === itemId && !isArchived(c)).first();
    if (ci) await softDelete('checkedItems', ci.id);
  } else {
    await addRow('checkedItems', { runId: currentRunId, itemId, checkedAt: now() });
  }
}

async function finishTrip() {
  if (!currentRunId) return;
  const t = now();

  const checkedNow = await db.checkedItems
    .filter(ci => ci.runId === currentRunId && !isArchived(ci))
    .toArray();

  const removedIds = new Set((await db.items.filter(i => isRemoved(i)).toArray()).map(i => i.id));
  const savable = checkedNow.filter(ci => !removedIds.has(ci.itemId));

  if (savable.length > 0) {
    const result = await showConfirm(
      `You have ${savable.length} ticked item${savable.length !== 1 ? 's' : ''}. Save as purchased before leaving?`,
      { confirmText: 'Save & Leave', thirdText: 'Just Leave' }
    );
    if (result === false) return;
    if (result === true) {
      await Promise.all(savable.map(ci => buyItem(ci.itemId)));
    }
  }

  await mutateRow('shoppingRuns', currentRunId, { completedAt: t });
  showGrid();
}
