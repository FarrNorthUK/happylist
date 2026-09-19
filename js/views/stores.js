import db from '../db.js';
import { liveQuery } from 'dexie';
import {
  isArchived, isAssociated, storeCounts,
  addRow, mutateRow, deleteStore,
} from '../data.js';
import { showConfirm } from '../confirm.js';
import { CARD_FORMATS, showCardOverlay, scanCardImage } from '../card.js';
import { computeStoreList, computeDeleteStoreMessage } from './stores-model.js';
import { esc } from '../dom.js';

const COLOURS = [
  '#e31837','#d81b60','#e65100','#e87722','#f57f17','#78be20','#2e7d32',
  '#00796b','#0288d1','#005daa','#1a237e','#5e35b1','#6d4c41','#455a64',
];

let subscription = null;
let pendingCardImage = null;

export function initStores() {
  const sel = document.getElementById('card-format-select');
  sel.innerHTML = CARD_FORMATS.map(f => `<option value="${f.id}">${f.label}</option>`).join('');

  subscription?.unsubscribe();
  subscription = liveQuery(() =>
    db.stores.filter(s => !isArchived(s)).sortBy('sortOrder')
  ).subscribe({ next: renderList, error: console.error });

  document.getElementById('btn-add-store').onclick = () => openModal(null);
  document.getElementById('btn-save-store').onclick = saveStore;
  document.getElementById('btn-delete-store').onclick = confirmDeleteStore;
  document.getElementById('btn-cancel-store').onclick = closeModal;
  document.querySelector('#modal-store .modal-backdrop').onclick = closeModal;

  // Card scan button
  document.getElementById('btn-scan-card').onclick = () => {
    if ('BarcodeDetector' in window) {
      document.getElementById('card-image-input').click();
    } else {
      showCardEntry('', 'code_128');
    }
  };
  document.getElementById('card-image-input').onchange = handleCardImageSelected;

  // Manual entry: sync hidden fields on input/change
  document.getElementById('card-number-input').oninput = () => {
    document.getElementById('store-card-number').value =
      document.getElementById('card-number-input').value.trim();
  };
  document.getElementById('card-format-select').onchange = () => {
    document.getElementById('store-card-format').value =
      document.getElementById('card-format-select').value;
  };
  document.getElementById('card-clear-link').onclick = clearCard;

  // Barcode overlay: tap anywhere to close
  document.getElementById('barcode-overlay').addEventListener('click', closeBarcodeOverlay);

  // Barcode icon clicks (delegated from store list)
  document.getElementById('store-list').addEventListener('click', e => {
    const btn = e.target.closest('.barcode-btn');
    if (!btn) return;
    e.stopPropagation();
    const id = Number(btn.dataset.id);
    db.stores.get(id).then(store => { if (store) showCardOverlay(store); });
  });
}

async function handleCardImageSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  const result = await scanCardImage(file, {
    onStatus: text => { document.getElementById('card-scan-status').textContent = text; },
  });
  if (result.ok) {
    pendingCardImage = result.image;
    showCardEntry(result.number, result.format);
  } else if (result.reason === 'error') {
    showCardEntry('', 'code_128');
  }
}

function showCardEntry(number, format) {
  document.getElementById('store-card-number').value = number;
  document.getElementById('store-card-format').value = format;
  document.getElementById('card-number-input').value = number;
  const sel = document.getElementById('card-format-select');
  if ([...sel.options].some(o => o.value === format)) sel.value = format;
  document.getElementById('card-manual-entry').classList.remove('hidden');
  document.getElementById('btn-scan-card').textContent = 'Re-scan';
}

function clearCard() {
  document.getElementById('store-card-number').value = '';
  document.getElementById('store-card-format').value = '';
  document.getElementById('card-number-input').value = '';
  document.getElementById('card-manual-entry').classList.add('hidden');
  document.getElementById('btn-scan-card').textContent = 'Scan card from photo';
  document.getElementById('card-scan-status').textContent = '';
  pendingCardImage = null;
}

async function renderList(stores) {
  const vm = computeStoreList({ stores, itemCounts: await getItemCounts() });
  renderStoreRows(vm, stores);
}

function renderStoreRows(vm, stores) {
  const ul = document.getElementById('store-list');
  if (vm.empty) {
    ul.innerHTML = '<li class="empty-state">No stores yet. Tap + to add one.</li>';
    return;
  }
  ul.innerHTML = '';
  vm.rows.forEach((row, idx) => {
    const store = stores[idx];
    const li = document.createElement('li');
    li.className = 'store-row';

    const barcodeBtnHtml = row.hasCard
      ? `<button class="barcode-btn" data-id="${row.id}" title="Show loyalty card" aria-label="Show loyalty card barcode">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
             <path d="M3 5v14M7 5v14M11 5v14M15 5v8M19 5v8M15 17v2M19 17v2"/>
           </svg>
         </button>`
      : '';

    li.innerHTML = `
      <span class="store-swatch" style="background:${row.bg}"></span>
      <span class="store-row-name">${esc(row.name)}</span>
      <span class="store-row-count">${row.count} items</span>
      ${barcodeBtnHtml}
      <div class="reorder-btns">
        <button class="reorder-btn" data-dir="up" data-idx="${idx}" ${row.canUp ? '' : 'disabled'}>▲</button>
        <button class="reorder-btn" data-dir="down" data-idx="${idx}" ${row.canDown ? '' : 'disabled'}>▼</button>
      </div>`;
    li.querySelector('.store-row-name').onclick = () => openModal(store);
    li.querySelector('[data-dir=up]').onclick = (e) => { e.stopPropagation(); reorder(stores, idx, -1); };
    li.querySelector('[data-dir=down]').onclick = (e) => { e.stopPropagation(); reorder(stores, idx, 1); };
    ul.appendChild(li);
  });
}

async function getItemCounts() {
  const items = await db.items.filter(isAssociated).toArray();
  return storeCounts(items);
}

async function reorder(stores, idx, dir) {
  const other = stores[idx + dir];
  const current = stores[idx];
  if (!other) return;
  await mutateRow('stores', current.id, { sortOrder: other.sortOrder });
  await mutateRow('stores', other.id, { sortOrder: current.sortOrder });
}

function openModal(store) {
  const modal = document.getElementById('modal-store');
  document.getElementById('modal-store-title').textContent = store ? 'Edit Store' : 'Add Store';
  document.getElementById('store-id').value = store?.id ?? '';
  document.getElementById('store-name').value = store?.name ?? '';
  document.getElementById('store-colour').value = store?.colour ?? COLOURS[0];
  document.getElementById('store-colour2').value = store?.colour2 ?? '';
  document.getElementById('btn-delete-store').classList.toggle('hidden', !store || store.general === true);
  document.getElementById('store-name').disabled = store?.general === true;
  renderColourPicker(store?.colour ?? COLOURS[0]);
  renderColourPicker2(store?.colour2 ?? '');

  // Card fields
  const cardNumber = store?.cardNumber ?? '';
  const cardFormat = store?.cardFormat ?? '';
  pendingCardImage = store?.cardImage ?? null;
  document.getElementById('card-scan-status').textContent = '';
  if (cardNumber) {
    showCardEntry(cardNumber, cardFormat);
  } else {
    clearCard();
    if (!('BarcodeDetector' in window)) {
      // Safari/Firefox: skip the scan button, go straight to manual entry
      showCardEntry('', 'code_128');
      document.getElementById('btn-scan-card').classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
}

function renderColourPicker(selected) {
  const container = document.getElementById('colour-picker');
  container.innerHTML = '';
  COLOURS.forEach(colour => {
    const sw = document.createElement('button');
    sw.className = 'colour-swatch' + (colour === selected ? ' selected' : '');
    sw.style.background = colour;
    sw.setAttribute('aria-label', colour);
    sw.onclick = () => {
      document.getElementById('store-colour').value = colour;
      container.querySelectorAll('.colour-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    };
    container.appendChild(sw);
  });
}

function renderColourPicker2(selected) {
  const container = document.getElementById('colour-picker-2');
  container.innerHTML = '';

  const none = document.createElement('button');
  none.className = 'colour-swatch colour-swatch--none' + (!selected ? ' selected' : '');
  none.setAttribute('aria-label', 'None');
  none.onclick = () => {
    document.getElementById('store-colour2').value = '';
    container.querySelectorAll('.colour-swatch').forEach(s => s.classList.remove('selected'));
    none.classList.add('selected');
  };
  container.appendChild(none);

  COLOURS.forEach(colour => {
    const sw = document.createElement('button');
    sw.className = 'colour-swatch' + (colour === selected ? ' selected' : '');
    sw.style.background = colour;
    sw.setAttribute('aria-label', colour);
    sw.onclick = () => {
      document.getElementById('store-colour2').value = colour;
      container.querySelectorAll('.colour-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    };
    container.appendChild(sw);
  });
}

function closeModal() {
  document.getElementById('modal-store').classList.add('hidden');
}

async function saveStore() {
  const name = document.getElementById('store-name').value.trim();
  if (!name) { document.getElementById('store-name').focus(); return; }
  const id = document.getElementById('store-id').value;
  const editing = id ? await db.stores.get(Number(id)) : null;
  if (name.toLowerCase() === 'general' && !editing?.general) {
    document.getElementById('store-name').focus();
    return;
  }
  const colour = document.getElementById('store-colour').value;
  const colour2 = document.getElementById('store-colour2').value || null;
  const cardNumber = document.getElementById('store-card-number').value || null;
  const cardFormat = document.getElementById('store-card-format').value || null;
  const cardImage = pendingCardImage || null;

  const fields = { name, colour, colour2, cardNumber, cardFormat, cardImage };

  if (id) {
    await mutateRow('stores', Number(id), fields);
  } else {
    const maxOrder = await db.stores.orderBy('sortOrder').last();
    await addRow('stores', { ...fields, sortOrder: (maxOrder?.sortOrder ?? -1) + 1 });
  }
  closeModal();
}

async function confirmDeleteStore() {
  const id = Number(document.getElementById('store-id').value);
  if (!id) return;
  const store = await db.stores.get(id);
  if (!store) return;

  const linked = await db.items.filter(i => !isArchived(i) && (i.storeIds || []).includes(id)).toArray();
  if (!await showConfirm(computeDeleteStoreMessage({ storeName: store.name, linkedItems: linked }), { confirmText: 'Delete', danger: true })) return;

  await deleteStore(id);
  closeModal();
}

function closeBarcodeOverlay() {
  document.getElementById('barcode-overlay').classList.add('hidden');
  screen.orientation?.unlock?.();
}
