// Loyalty card module.
// Pure core (DOM-free, tested in Node): CARD_FORMATS, cardDisplayMode, cropRegion, hasCard.
// Browser layer: renderCard, showCardOverlay, scanCardImage, script loaders.

// Single source of truth for card formats.
// jsBarcode: JsBarcode format name (renderable 1D).
// displayOnly: 2D formats BarcodeDetector reads but we can only show as saved image (or QR for qr_code).
export const CARD_FORMATS = [
  { id: 'code_128',    label: 'Code 128 (most loyalty cards)', jsBarcode: 'CODE128' },
  { id: 'ean_13',      label: 'EAN-13',                        jsBarcode: 'EAN13' },
  { id: 'ean_8',       label: 'EAN-8',                         jsBarcode: 'EAN8' },
  { id: 'code_39',     label: 'Code 39',                       jsBarcode: 'CODE39' },
  { id: 'upc_a',       label: 'UPC-A',                         jsBarcode: 'UPC' },
  { id: 'upc_e',       label: 'UPC-E',                         jsBarcode: 'UPC_E' },
  { id: 'qr_code',     label: 'QR Code',                       displayOnly: true },
  { id: 'pdf417',      label: 'PDF417',                        displayOnly: true },
  { id: 'aztec',       label: 'Aztec',                         displayOnly: true },
  { id: 'data_matrix', label: 'Data Matrix',                   displayOnly: true },
];

export const SCAN_FORMATS = CARD_FORMATS.map(f => f.id);

export function hasCard(store) {
  return Boolean(store?.cardNumber);
}

/**
 * Decide how to display a store's loyalty card.
 * Returns one of:
 *   { kind: 'none' }    — no card number
 *   { kind: 'barcode', jsFormat } — render with JsBarcode
 *   { kind: 'image' }   — show the saved cropped image
 *   { kind: 'qr' }      — render a QR code (qr_code without saved image)
 *   { kind: 'number' }  — show the raw number as text (unknown/unrenderable format)
 */
export function cardDisplayMode(store) {
  if (!hasCard(store)) return { kind: 'none' };
  const fmt = CARD_FORMATS.find(f => f.id === store.cardFormat);
  if (!fmt) return { kind: 'number' };
  if (fmt.jsBarcode) return { kind: 'barcode', jsFormat: fmt.jsBarcode };
  if (store.cardImage) return { kind: 'image' };
  if (fmt.id === 'qr_code') return { kind: 'qr' };
  return { kind: 'number' };
}

/**
 * Crop region for a detected barcode: 10% padding on the min dimension,
 * clamped to the bitmap bounds.
 */
export function cropRegion(bitmapWidth, bitmapHeight, box) {
  const pad = Math.round(Math.min(box.width, box.height) * 0.1);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const width = Math.min(bitmapWidth - x, box.width + pad * 2);
  const height = Math.min(bitmapHeight - y, box.height + pad * 2);
  return { x, y, width, height };
}

// ── Browser layer ──

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

async function loadJsBarcode() {
  await loadScript('https://cdn.jsdelivr.net/npm/jsbarcode@3/dist/JsBarcode.all.min.js');
}

async function loadQRCode() {
  await loadScript('https://cdn.jsdelivr.net/npm/qrcode@1/build/qrcode.min.js');
}

/**
 * Draw a store's card into the overlay targets.
 * targets: { svg, canvas, img, fallback }
 */
export async function renderCard(store, { svg, canvas, img, fallback }) {
  svg.classList.add('hidden');
  canvas.classList.add('hidden');
  img.classList.add('hidden');
  fallback.classList.add('hidden');
  svg.innerHTML = '';

  const mode = cardDisplayMode(store);

  if (mode.kind === 'barcode') {
    await loadJsBarcode();
    try {
      svg.classList.remove('hidden');
      window.JsBarcode(svg, store.cardNumber, {
        format: mode.jsFormat,
        displayValue: true,
        fontSize: 18,
        margin: 12,
      });
    } catch {
      svg.classList.add('hidden');
      fallback.classList.remove('hidden');
      fallback.textContent = store.cardNumber;
    }
  } else if (mode.kind === 'image') {
    img.src = store.cardImage;
    img.classList.remove('hidden');
  } else if (mode.kind === 'qr') {
    await loadQRCode();
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
}

/** Show the fullscreen barcode overlay for a store. */
export async function showCardOverlay(store) {
  const overlay = document.getElementById('barcode-overlay');
  overlay.querySelector('.barcode-store-name').textContent = store.name;
  await renderCard(store, {
    svg: document.getElementById('barcode-svg'),
    canvas: document.getElementById('barcode-canvas'),
    img: document.getElementById('barcode-img'),
    fallback: document.getElementById('barcode-fallback-number'),
  });
  overlay.classList.remove('hidden');
  screen.orientation?.lock('landscape').catch(() => {});
}

/**
 * Scan a card from a photo file.
 * Returns { ok: true, number, format, image } or { ok: false, reason: 'not-found' | 'error' }.
 * onStatus(text) reports progress to the UI ('' clears).
 */
export async function scanCardImage(file, { onStatus = () => {} } = {}) {
  onStatus('Scanning…');
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const detector = new BarcodeDetector({ formats: SCAN_FORMATS });
      const results = await detector.detect(bitmap);

      if (!results.length) {
        onStatus('No barcode found — try a clearer screenshot.');
        return { ok: false, reason: 'not-found' };
      }

      onStatus('');
      const { rawValue, format, boundingBox } = results[0];

      let image = null;
      try {
        const { x, y, width, height } = cropRegion(bitmap.width, bitmap.height, boundingBox);
        const crop = document.createElement('canvas');
        crop.width = width;
        crop.height = height;
        crop.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, width, height);
        image = crop.toDataURL('image/png');
      } catch {
        image = null;
      }

      return { ok: true, number: rawValue, format, image };
    } finally {
      bitmap.close();
    }
  } catch (err) {
    console.error('BarcodeDetector error:', err);
    onStatus('Scan failed — enter the number manually below.');
    return { ok: false, reason: 'error' };
  }
}
