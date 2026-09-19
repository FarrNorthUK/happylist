import db from '../db.js';
import { liveQuery } from 'dexie';
import { showConfirm } from '../confirm.js';
import {
  isArchived, isRemoved, isInactive,
  upsertItem, removeFromList, reactivateItem, softDelete,
} from '../data.js';
import { computeListView } from './list-model.js';
import { esc, storeBg, titleCase } from '../dom.js';

let subscription = null;
let activeStoreFilter = null;
let searchQuery = '';
let _pickerStores = [];
let _selectedStoreIds = new Set();

export function initList() {
  subscription?.unsubscribe();
  subscription = liveQuery(async () => {
    const [items, stores] = await Promise.all([
      db.items.filter(i => !isArchived(i)).toArray(),
      db.stores.filter(s => !isArchived(s)).sortBy('sortOrder'),
    ]);
    return { items, stores };
  }).subscribe({
    next: data => { _lastData = data; renderNow(); },
    error: console.error,
  });

  document.getElementById('btn-add-item').onclick = () => openItemModal(null, titleCase(searchQuery));
  document.getElementById('btn-save-item').onclick = saveItem;
  document.getElementById('btn-archive-item').onclick = archiveItem;
  document.getElementById('btn-remove-item').onclick = removeItem;
  document.getElementById('btn-cancel-item').onclick = closeItemModal;
  document.querySelector('#modal-item .modal-backdrop').onclick = closeItemModal;
  document.getElementById('btn-pick-stores').onclick = openStorePicker;
  document.getElementById('store-picker-backdrop').onclick = closeStorePicker;
  document.getElementById('btn-store-picker-done').onclick = closeStorePicker;

  const searchEl = document.getElementById('list-search');
  searchEl.addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderNow();
  });
}

let _lastData = null;

function renderNow() {
  if (!_lastData) return;
  const vm = computeListView({
    items: _lastData.items,
    stores: _lastData.stores,
    activeStoreFilter,
    searchQuery,
  });
  renderFilters(vm.filters);
  renderItems(vm);
}

function renderFilters(filters) {
  const container = document.getElementById('list-store-filters');
  const existing = [...container.querySelectorAll('.chip')];
  const sameShape = existing.length === filters.length
    && existing.every((el, i) =>
      el.textContent === filters[i].label
      && el.classList.contains('active') === filters[i].active);
  if (sameShape) return;

  container.innerHTML = '';
  filters.forEach(f => container.appendChild(makeChip(f)));
}

function makeChip(f) {
  const btn = document.createElement('button');
  btn.className = 'chip' + (f.active ? ' active' : '');
  btn.textContent = f.label;
  if (f.colour && f.active) btn.style.background = f.colour;
  btn.onclick = () => {
    activeStoreFilter = f.storeId;
    renderNow();
  };
  return btn;
}

function renderItems({ active, inactive, empty }) {
  const storeMap = Object.fromEntries(_lastData.stores.map(s => [s.id, s]));
  const ul = document.getElementById('item-list');
  ul.innerHTML = '';

  if (empty) {
    const noMatch = empty === 'no-match';
    ul.innerHTML = `<li class="empty-state">${noMatch ? 'No items match the filter.' : 'No items yet.\nTap + to add one.'}</li>`;
    if (noMatch && searchQuery) {
      const name = titleCase(searchQuery);
      const btn = document.createElement('button');
      btn.className = 'empty-add-btn';
      btn.textContent = `Add "${name}"`;
      btn.onclick = () => openItemModal(null, name);
      ul.querySelector('.empty-state').appendChild(btn);
    }
    return;
  }

  active.forEach(item => ul.appendChild(makeItemRow(item, storeMap)));

  if (inactive.length) {
    const divider = document.createElement('li');
    divider.className = 'inactive-divider';
    divider.textContent = 'Off the list — tap to re-add';
    ul.appendChild(divider);
    inactive.forEach(item => ul.appendChild(makeItemRow(item, storeMap)));
  }
}

function storeInitials(name) {
  return name
    .split(/\s+/)
    .map(w => w === '&' ? '&' : w[0].toUpperCase())
    .join(' ')
    .replace(/ & /g, '&');
}

function makeItemRow(item, storeMap) {
  const offList = isInactive(item);
  const li = document.createElement('li');
  li.className = 'item-row';
  const tags = (item.storeIds || []).map(sid => {
    const s = storeMap[sid];
    return s ? `<span class="store-tag" style="background:${storeBg(s)}">${esc(storeInitials(s.name))}</span>` : '';
  }).join('');
  const qtyTag  = item.quantity ? `<span class="item-inline-tag">(Qty ${esc(item.quantity)})</span>` : '';
  const unitTag = item.unit     ? `<span class="item-inline-tag">(Size ${esc(item.unit)})</span>`     : '';
  li.innerHTML = `
    ${offList ? '<button class="primary-btn">Add</button>' : ''}
    <div class="item-main">
      <div class="item-name-row">
        <span class="item-name">${esc(item.name)}</span>
        ${qtyTag}${unitTag}
      </div>
      ${item.notes ? `<div class="item-notes">${esc(item.notes)}</div>` : ''}
    </div>
    ${tags ? `<div class="item-tags">${tags}</div>` : ''}`;

  li.onclick = () => openItemModal(item);
  if (offList) {
    li.querySelector('.primary-btn').onclick = async e => {
      e.stopPropagation();
      if (!await showConfirm(`Add "${item.name}" back to list?`, { confirmText: 'Add' })) return;
      await reactivateItem(item.id);
    };
  }
  return li;
}

async function openItemModal(item, prefillName = '') {
  const stores = await db.stores.filter(s => !isArchived(s)).sortBy('sortOrder');

  document.getElementById('modal-item-title').textContent = item ? 'Edit Item' : 'Add Item';
  document.getElementById('item-id').value = item?.id ?? '';
  document.getElementById('item-name').value = item?.name ?? prefillName;
  document.getElementById('item-qty').value = item?.quantity ?? '';
  document.getElementById('item-unit').value = item?.unit ?? '';
  document.getElementById('item-notes').value = item?.notes ?? '';
  document.getElementById('btn-archive-item').classList.toggle('hidden', !item);
  document.getElementById('btn-remove-item').classList.toggle('hidden', !item || isRemoved(item));

  _pickerStores = stores;
  _selectedStoreIds = new Set((item?.storeIds || []).map(Number));
  updateStorePickerBtn();

  document.getElementById('modal-item').classList.remove('hidden');
}

function closeItemModal() {
  document.getElementById('modal-item').classList.add('hidden');
}

function updateStorePickerBtn() {
  const btn = document.getElementById('btn-pick-stores');
  if (!_selectedStoreIds.size) {
    btn.textContent = '— no stores —';
    return;
  }
  const names = _pickerStores.filter(s => _selectedStoreIds.has(s.id)).map(s => s.name);
  btn.textContent = names.join(', ');
}

function openStorePicker() {
  const list = document.getElementById('store-picker-list');
  list.innerHTML = '';
  if (!_pickerStores.length) {
    list.innerHTML = '<li style="color:var(--grey-4);cursor:default">No stores yet — add stores in Settings.</li>';
  } else {
    _pickerStores.forEach(store => {
      const li = document.createElement('li');
      const selected = _selectedStoreIds.has(store.id);
      if (selected) li.classList.add('store-picker-selected');
      li.innerHTML = `
        <span class="store-picker-check">${selected ? '✓' : ''}</span>
        <span style="background:${store.colour};width:14px;height:14px;border-radius:50%;display:inline-block;flex-shrink:0"></span>
        ${esc(store.name)}`;
      li.onclick = () => {
        if (_selectedStoreIds.has(store.id)) {
          _selectedStoreIds.delete(store.id);
          li.classList.remove('store-picker-selected');
          li.querySelector('.store-picker-check').textContent = '';
        } else {
          _selectedStoreIds.add(store.id);
          li.classList.add('store-picker-selected');
          li.querySelector('.store-picker-check').textContent = '✓';
        }
        updateStorePickerBtn();
      };
      list.appendChild(li);
    });
  }
  document.getElementById('modal-store-picker').classList.remove('hidden');
}

function closeStorePicker() {
  document.getElementById('modal-store-picker').classList.add('hidden');
}

async function saveItem() {
  const name = document.getElementById('item-name').value.trim();
  if (!name) { document.getElementById('item-name').focus(); return; }
  const id = document.getElementById('item-id').value;
  const storeIds = [..._selectedStoreIds];

  const fields = {
    name,
    quantity:   document.getElementById('item-qty').value.trim()  || null,
    unit:       document.getElementById('item-unit').value.trim() || null,
    notes:      document.getElementById('item-notes').value.trim() || null,
    storeIds,
  };

  await upsertItem(id ? Number(id) : null, fields);
  if (!id) clearSearch();
  closeItemModal();
}

function clearSearch() {
  document.getElementById('list-search').value = '';
  searchQuery = '';
  renderNow();
}

async function removeItem() {
  const id = Number(document.getElementById('item-id').value);
  if (!id) return;
  if (!await showConfirm('Remove from list? Item stays saved — re-add it from Removed.', { confirmText: 'Remove' })) return;
  await removeFromList(id);
  closeItemModal();
}

async function archiveItem() {
  const id = Number(document.getElementById('item-id').value);
  if (!id) return;
  if (!await showConfirm('Delete this item?', { confirmText: 'Delete', danger: true })) return;
  await softDelete('items', id);
  closeItemModal();
}
