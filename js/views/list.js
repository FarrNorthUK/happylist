import db, { now } from '../db.js';
import { liveQuery } from 'https://cdn.jsdelivr.net/npm/dexie@4/dist/dexie.mjs';
import { showConfirm } from '../confirm.js';

let subscription = null;
let activeStoreFilter = null;
let searchQuery = '';
let _pickerCategories = [];
let _pickerStores = [];
let _selectedStoreIds = new Set();

export function initList() {
  subscription?.unsubscribe();
  subscription = liveQuery(async () => {
    const [items, stores, categories] = await Promise.all([
      db.items.filter(i => !i.deletedAt).toArray(),
      db.stores.filter(s => !s.deletedAt).sortBy('sortOrder'),
      db.categories.filter(c => !c.deletedAt).sortBy('sortOrder'),
    ]);
    return { items, stores, categories };
  }).subscribe({ next: render, error: console.error });

  document.getElementById('btn-add-item').onclick = () => openItemModal(null);
  document.getElementById('btn-save-item').onclick = saveItem;
  document.getElementById('btn-archive-item').onclick = archiveItem;
  document.getElementById('btn-cancel-item').onclick = closeItemModal;
  document.querySelector('#modal-item .modal-backdrop').onclick = closeItemModal;
  document.getElementById('btn-pick-category').onclick = openCatPicker;
  document.getElementById('cat-picker-backdrop').onclick = closeCatPicker;
  document.getElementById('btn-pick-stores').onclick = openStorePicker;
  document.getElementById('store-picker-backdrop').onclick = closeStorePicker;
  document.getElementById('btn-store-picker-done').onclick = closeStorePicker;

  const searchEl = document.getElementById('list-search');
  searchEl.addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    reRenderItems();
  });
}

let _lastData = null;

function render(data) {
  _lastData = data;
  renderFilters(data.stores);
  reRenderItems();
}

function renderFilters(stores) {
  const container = document.getElementById('list-store-filters');
  const existing = container.querySelectorAll('.chip');
  const labels = ['All', ...stores.map(s => s.name)];
  const existingLabels = [...existing].map(e => e.textContent);
  if (JSON.stringify(labels) === JSON.stringify(existingLabels)) return;

  container.innerHTML = '';
  container.appendChild(makeChip('All', null));
  stores.forEach(store => container.appendChild(makeChip(store.name, store.id, store.colour)));
}

function makeChip(label, storeId, colour) {
  const btn = document.createElement('button');
  btn.className = 'chip' + (activeStoreFilter === storeId ? ' active' : '');
  btn.textContent = label;
  if (colour && activeStoreFilter === storeId) btn.style.background = colour;
  btn.onclick = () => {
    activeStoreFilter = storeId;
    document.querySelectorAll('#list-store-filters .chip').forEach(c => {
      c.classList.remove('active');
      c.style.background = '';
    });
    btn.classList.add('active');
    if (colour) btn.style.background = colour;
    reRenderItems();
  };
  return btn;
}

function reRenderItems() {
  if (!_lastData) return;
  const { items, stores, categories } = _lastData;
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s]));
  const catMap   = Object.fromEntries(categories.map(c => [c.id, c]));

  const matchesFilter = item => {
    if (activeStoreFilter !== null && !(item.storeIds || []).includes(activeStoreFilter)) return false;
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery)) return false;
    return true;
  };

  const active = items.filter(i => !i.boughtAt && matchesFilter(i));
  const bought = items.filter(i =>  i.boughtAt && matchesFilter(i));
  active.sort((a, b) => a.name.localeCompare(b.name));
  bought.sort((a, b) => a.name.localeCompare(b.name));

  const ul = document.getElementById('item-list');
  ul.innerHTML = '';

  if (!active.length && !bought.length) {
    ul.innerHTML = `<li class="empty-state">${items.length ? 'No items match the filter.' : 'No items yet.\nTap + to add one.'}</li>`;
    return;
  }

  active.forEach(item => ul.appendChild(makeItemRow(item, storeMap, catMap, false)));

  if (bought.length) {
    const divider = document.createElement('li');
    divider.className = 'bought-divider';
    divider.textContent = 'Recently bought — tap to re-add';
    ul.appendChild(divider);
    bought.forEach(item => ul.appendChild(makeItemRow(item, storeMap, catMap, true)));
  }
}

function storeBg(store) {
  return store.colour2
    ? `linear-gradient(135deg, ${store.colour} 50%, ${store.colour2} 50%)`
    : store.colour;
}

function storeInitials(name) {
  return name
    .split(/\s+/)
    .map(w => w === '&' ? '&' : w[0].toUpperCase())
    .join(' ')
    .replace(/ & /g, '&');
}

function makeItemRow(item, storeMap, catMap, isBought) {
  const li = document.createElement('li');
  li.className = 'item-row' + (isBought ? ' item-row--bought' : '');
  const tags = (item.storeIds || []).map(sid => {
    const s = storeMap[sid];
    return s ? `<span class="store-tag" style="background:${storeBg(s)}">${esc(storeInitials(s.name))}</span>` : '';
  }).join('');
  const meta = [item.quantity, item.unit].filter(Boolean).join(' ');
  li.innerHTML = `
    ${isBought ? '<button class="readd-btn">Add</button>' : ''}
    <div class="item-main">
      <div class="item-name-row">
        <span class="item-name">${esc(item.name)}</span>
      </div>
      ${meta ? `<div class="item-meta">${esc(meta)}</div>` : ''}
    </div>
    ${tags ? `<div class="item-tags">${tags}</div>` : ''}`;

  li.onclick = () => openItemModal(item);
  if (isBought) {
    li.querySelector('.readd-btn').onclick = async e => {
      e.stopPropagation();
      if (!await showConfirm(`Add "${item.name}" back to list?`, { confirmText: 'Add' })) return;
      reAddItem(item.id);
    };
  }
  return li;
}

async function reAddItem(id) {
  await db.items.update(id, { boughtAt: null, updatedAt: now() });
  triggerSyncSoon();
}

async function openItemModal(item) {
  const [stores, categories] = await Promise.all([
    db.stores.filter(s => !s.deletedAt).sortBy('sortOrder'),
    db.categories.filter(c => !c.deletedAt).sortBy('sortOrder'),
  ]);

  document.getElementById('modal-item-title').textContent = item ? 'Edit Item' : 'Add Item';
  document.getElementById('item-id').value = item?.id ?? '';
  document.getElementById('item-name').value = item?.name ?? '';
  document.getElementById('item-qty').value = item?.quantity ?? '';
  document.getElementById('item-unit').value = item?.unit ?? '';
  document.getElementById('item-notes').value = item?.notes ?? '';
  document.getElementById('btn-archive-item').classList.toggle('hidden', !item);

  _pickerCategories = categories;
  const selectedCat = item?.categoryId ? categories.find(c => c.id === item.categoryId) : null;
  document.getElementById('item-category').value = selectedCat?.id ?? '';
  document.getElementById('btn-pick-category').textContent = selectedCat?.name ?? '— no category —';

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

function openCatPicker() {
  const currentVal = document.getElementById('item-category').value;
  const list = document.getElementById('cat-picker-list');
  list.innerHTML = '';

  const none = document.createElement('li');
  none.textContent = '— no category —';
  if (!currentVal) none.classList.add('cat-picker-selected');
  none.onclick = () => selectCategory('', '— no category —');
  list.appendChild(none);

  _pickerCategories.forEach(c => {
    const li = document.createElement('li');
    li.textContent = c.name;
    if (String(c.id) === String(currentVal)) li.classList.add('cat-picker-selected');
    li.onclick = () => selectCategory(c.id, c.name);
    list.appendChild(li);
  });

  document.getElementById('modal-cat-picker').classList.remove('hidden');
}

function selectCategory(id, name) {
  document.getElementById('item-category').value = id;
  document.getElementById('btn-pick-category').textContent = name;
  closeCatPicker();
}

function closeCatPicker() {
  document.getElementById('modal-cat-picker').classList.add('hidden');
}

async function saveItem() {
  const name = document.getElementById('item-name').value.trim();
  if (!name) { document.getElementById('item-name').focus(); return; }
  const id = document.getElementById('item-id').value;
  const storeIds = [..._selectedStoreIds];
  const catVal = document.getElementById('item-category').value;
  const t = now();

  const data = {
    name,
    quantity:   document.getElementById('item-qty').value.trim()  || null,
    unit:       document.getElementById('item-unit').value.trim() || null,
    notes:      document.getElementById('item-notes').value.trim() || null,
    categoryId: catVal ? Number(catVal) : null,
    storeIds,
    updatedAt:  t,
  };

  if (id) {
    await db.items.update(Number(id), data);
  } else {
    await db.items.add({ ...data, deletedAt: null, boughtAt: null });
  }
  triggerSyncSoon();
  closeItemModal();
}

async function archiveItem() {
  const id = Number(document.getElementById('item-id').value);
  if (!id) return;
  if (!await showConfirm('Delete this item?', { confirmText: 'Delete', danger: true })) return;
  await db.items.update(id, { deletedAt: now(), updatedAt: now() });
  triggerSyncSoon();
  closeItemModal();
}

function triggerSyncSoon() {
  window.dispatchEvent(new CustomEvent('happylist:mutated'));
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
