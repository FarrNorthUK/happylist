import db, { now } from '../db.js';
import { liveQuery } from 'https://cdn.jsdelivr.net/npm/dexie@4/dist/dexie.mjs';

const COLOURS = [
  '#e31837','#d81b60','#e65100','#e87722','#f57f17','#78be20','#2e7d32',
  '#00796b','#0288d1','#005daa','#1a237e','#5e35b1','#6d4c41','#455a64',
];

// BarcodeDetector format name → JsBarcode format name
const FORMAT_MAP = {
  ean_13: 'EAN13', ean_8: 'EAN8',
  code_128: 'CODE128', code_39: 'CODE39',
  upc_a: 'UPC', upc_e: 'UPC_E',
};
// Formats BarcodeDetector can read but JsBarcode can't render
const DISPLAY_ONLY_FORMATS = new Set(['qr_code', 'pdf417', 'aztec', 'data_matrix']);

let subscription = null;
let pendingCardImage = null;

export function initStores() {
  subscription?.unsubscribe();
  subscription = liveQuery(() =>
    db.stores.filter(s => !s.deletedAt).sortBy('sortOrder')
  ).subscribe({ next: renderList, error: console.error });

  document.getElementById('btn-add-store').onclick = () => openModal(null);
  document.getElementById('btn-save-store').onclick = saveStore;
  document.getElementById('btn-delete-store').onclick = deleteStore;
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
    db.stores.get(id).then(store => { if (store) showBarcode(store); });
  });
}

async function handleCardImageSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';

  const statusEl = document.getElementById('card-scan-status');
  statusEl.textContent = 'Scanning…';

  try {
    const bitmap = await createImageBitmap(file);
    const detector = new BarcodeDetector({
      formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code','pdf417','aztec','data_matrix'],
    });
    const results = await detector.detect(bitmap);

    if (!results.length) {
      bitmap.close();
      statusEl.textContent = 'No barcode found — try a clearer screenshot.';
      return;
    }

    statusEl.textContent = '';
    const { rawValue, format, boundingBox } = results[0];

    // Crop the detected barcode region and save it for lossless display
    try {
      const pad = Math.round(Math.min(boundingBox.width, boundingBox.height) * 0.1);
      const x = Math.max(0, boundingBox.x - pad);
      const y = Math.max(0, boundingBox.y - pad);
      const w = Math.min(bitmap.width - x, boundingBox.width + pad * 2);
      const h = Math.min(bitmap.height - y, boundingBox.height + pad * 2);
      const crop = document.createElement('canvas');
      crop.width = w;
      crop.height = h;
      crop.getContext('2d').drawImage(bitmap, x, y, w, h, 0, 0, w, h);
      pendingCardImage = crop.toDataURL('image/png');
    } catch {
      pendingCardImage = null;
    }
    bitmap.close();

    showCardEntry(rawValue, format);
  } catch (err) {
    statusEl.textContent = 'Scan failed — enter the number manually below.';
    showCardEntry('', 'code_128');
    console.error('BarcodeDetector error:', err);
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
  const ul = document.getElementById('store-list');
  if (!stores.length) {
    ul.innerHTML = '<li class="empty-state">No stores yet. Tap + to add one.</li>';
    return;
  }
  const itemCounts = await getItemCounts();
  ul.innerHTML = '';
  stores.forEach((store, idx) => {
    const li = document.createElement('li');
    li.className = 'store-row';

    const barcodeBtnHtml = store.cardNumber
      ? `<button class="barcode-btn" data-id="${store.id}" title="Show loyalty card" aria-label="Show loyalty card barcode">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
             <path d="M3 5v14M7 5v14M11 5v14M15 5v8M19 5v8M15 17v2M19 17v2"/>
           </svg>
         </button>`
      : '';

    li.innerHTML = `
      <span class="store-swatch" style="background:${storeBg(store)}"></span>
      <span class="store-row-name">${esc(store.name)}</span>
      <span class="store-row-count">${itemCounts[store.id] ?? 0} items</span>
      ${barcodeBtnHtml}
      <div class="reorder-btns">
        <button class="reorder-btn" data-dir="up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="reorder-btn" data-dir="down" data-idx="${idx}" ${idx === stores.length - 1 ? 'disabled' : ''}>▼</button>
      </div>`;
    li.querySelector('.store-row-name').onclick = () => openModal(store);
    li.querySelector('[data-dir=up]').onclick = (e) => { e.stopPropagation(); reorder(stores, idx, -1); };
    li.querySelector('[data-dir=down]').onclick = (e) => { e.stopPropagation(); reorder(stores, idx, 1); };
    ul.appendChild(li);
  });
}

async function getItemCounts() {
  const items = await db.items.filter(i => !i.deletedAt).toArray();
  const counts = {};
  items.forEach(item => {
    (item.storeIds || []).forEach(sid => { counts[sid] = (counts[sid] ?? 0) + 1; });
  });
  return counts;
}

async function reorder(stores, idx, dir) {
  const other = stores[idx + dir];
  const current = stores[idx];
  if (!other) return;
  const t = now();
  await db.stores.update(current.id, { sortOrder: other.sortOrder, updatedAt: t });
  await db.stores.update(other.id, { sortOrder: current.sortOrder, updatedAt: t });
  triggerSyncSoon();
}

function openModal(store) {
  const modal = document.getElementById('modal-store');
  document.getElementById('modal-store-title').textContent = store ? 'Edit Store' : 'Add Store';
  document.getElementById('store-id').value = store?.id ?? '';
  document.getElementById('store-name').value = store?.name ?? '';
  document.getElementById('store-colour').value = store?.colour ?? COLOURS[0];
  document.getElementById('store-colour2').value = store?.colour2 ?? '';
  document.getElementById('btn-delete-store').classList.toggle('hidden', !store);
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

function storeBg(store) {
  return store.colour2
    ? `linear-gradient(135deg, ${store.colour} 50%, ${store.colour2} 50%)`
    : store.colour;
}

function closeModal() {
  document.getElementById('modal-store').classList.add('hidden');
}

async function saveStore() {
  const name = document.getElementById('store-name').value.trim();
  if (!name) { document.getElementById('store-name').focus(); return; }
  const id = document.getElementById('store-id').value;
  const colour = document.getElementById('store-colour').value;
  const colour2 = document.getElementById('store-colour2').value || null;
  const cardNumber = document.getElementById('store-card-number').value || null;
  const cardFormat = document.getElementById('store-card-format').value || null;
  const cardImage = pendingCardImage || null;
  const t = now();

  if (id) {
    await db.stores.update(Number(id), { name, colour, colour2, cardNumber, cardFormat, cardImage, updatedAt: t });
  } else {
    const maxOrder = await db.stores.orderBy('sortOrder').last();
    await db.stores.add({ name, colour, colour2, cardNumber, cardFormat, cardImage, sortOrder: (maxOrder?.sortOrder ?? -1) + 1, updatedAt: t, deletedAt: null });
  }
  triggerSyncSoon();
  closeModal();
}

async function deleteStore() {
  const id = Number(document.getElementById('store-id').value);
  if (!id) return;
  const store = await db.stores.get(id);
  if (!store) return;

  // Remove this store from all items that reference it
  const affected = await db.items.filter(i => !i.deletedAt && (i.storeIds || []).includes(id)).toArray();
  const t = now();
  await Promise.all(affected.map(item =>
    db.items.update(item.id, {
      storeIds: item.storeIds.filter(s => s !== id),
      updatedAt: t,
    })
  ));

  await db.stores.update(id, { deletedAt: t, updatedAt: t });
  triggerSyncSoon();
  closeModal();
}

function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function showBarcode(store) {
  const overlay = document.getElementById('barcode-overlay');
  const svg = document.getElementById('barcode-svg');
  const canvas = document.getElementById('barcode-canvas');
  const img = document.getElementById('barcode-img');
  const fallback = document.getElementById('barcode-fallback-number');
  const nameEl = overlay.querySelector('.barcode-store-name');

  nameEl.textContent = store.name;
  svg.classList.add('hidden');
  canvas.classList.add('hidden');
  img.classList.add('hidden');
  fallback.classList.add('hidden');
  svg.innerHTML = '';

  const jsFormat = FORMAT_MAP[store.cardFormat] ?? null;
  const isQR = store.cardFormat === 'qr_code';

  if (jsFormat) {
    await loadScript('https://cdn.jsdelivr.net/npm/jsbarcode@3/dist/JsBarcode.all.min.js');
    try {
      svg.classList.remove('hidden');
      window.JsBarcode(svg, store.cardNumber, {
        format: jsFormat,
        displayValue: true,
        fontSize: 18,
        margin: 12,
      });
    } catch {
      svg.classList.add('hidden');
      fallback.classList.remove('hidden');
      fallback.textContent = store.cardNumber;
    }
  } else if ((isQR || DISPLAY_ONLY_FORMATS.has(store.cardFormat)) && store.cardImage) {
    img.src = store.cardImage;
    img.classList.remove('hidden');
  } else if (isQR || DISPLAY_ONLY_FORMATS.has(store.cardFormat)) {
    await loadScript('https://cdn.jsdelivr.net/npm/qrcode@1/build/qrcode.min.js');
    try {
      canvas.classList.remove('hidden');
      const size = Math.min(window.innerWidth * 0.85, 400);
      await window.QRCode.toCanvas(canvas, store.cardNumber, { width: size, margin: 2 });
    } catch {
      canvas.classList.add('hidden');
      fallback.classList.remove('hidden');
      fallback.textContent = store.cardNumber;
    }
  } else {
    fallback.classList.remove('hidden');
    fallback.textContent = store.cardNumber;
  }

  overlay.classList.remove('hidden');
  screen.orientation?.lock('landscape').catch(() => {});
}

function closeBarcodeOverlay() {
  document.getElementById('barcode-overlay').classList.add('hidden');
  screen.orientation?.unlock?.();
}

function triggerSyncSoon() {
  window.dispatchEvent(new CustomEvent('happylist:mutated'));
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
