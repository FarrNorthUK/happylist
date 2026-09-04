import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_FORMATS, SCAN_FORMATS, hasCard, cardDisplayMode, cropRegion, scanCardImage,
} from '../js/card.js';

// ── cardDisplayMode ──

test('cardDisplayMode: no card', () => {
  assert.deepEqual(cardDisplayMode(null), { kind: 'none' });
  assert.deepEqual(cardDisplayMode({}), { kind: 'none' });
  assert.deepEqual(cardDisplayMode({ cardNumber: '' }), { kind: 'none' });
});

test('cardDisplayMode: every JsBarcode format renders as barcode', () => {
  for (const fmt of CARD_FORMATS.filter(f => f.jsBarcode)) {
    assert.deepEqual(
      cardDisplayMode({ cardNumber: '123', cardFormat: fmt.id }),
      { kind: 'barcode', jsFormat: fmt.jsBarcode },
    );
  }
});

test('cardDisplayMode: barcode format wins over saved image', () => {
  assert.deepEqual(
    cardDisplayMode({ cardNumber: '123', cardFormat: 'code_128', cardImage: 'data:image/png;base64,x' }),
    { kind: 'barcode', jsFormat: 'CODE128' },
  );
});

test('cardDisplayMode: unknown or missing format falls back to number', () => {
  assert.deepEqual(cardDisplayMode({ cardNumber: '123', cardFormat: 'barcode_42' }), { kind: 'number' });
  assert.deepEqual(cardDisplayMode({ cardNumber: '123' }), { kind: 'number' });
});

test('cardDisplayMode: display-only formats use saved image when present', () => {
  for (const fmt of CARD_FORMATS.filter(f => f.displayOnly)) {
    assert.deepEqual(
      cardDisplayMode({ cardNumber: '123', cardFormat: fmt.id, cardImage: 'data:image/png;base64,x' }),
      { kind: 'image' },
    );
  }
});

test('cardDisplayMode: qr_code without image renders QR', () => {
  assert.deepEqual(
    cardDisplayMode({ cardNumber: 'https://loyalty.example/card', cardFormat: 'qr_code' }),
    { kind: 'qr' },
  );
});

test('cardDisplayMode: other 2D formats without image fall back to number', () => {
  for (const id of ['pdf417', 'aztec', 'data_matrix']) {
    assert.deepEqual(cardDisplayMode({ cardNumber: '123', cardFormat: id }), { kind: 'number' });
  }
});

// ── cropRegion ──

test('cropRegion: 10% padding on the min dimension', () => {
  assert.deepEqual(
    cropRegion(1000, 500, { x: 200, y: 100, width: 100, height: 50 }),
    { x: 195, y: 95, width: 110, height: 60 },
  );
});

test('cropRegion: clamps to the top-left edges', () => {
  assert.deepEqual(
    cropRegion(1000, 500, { x: 2, y: 3, width: 100, height: 100 }),
    { x: 0, y: 0, width: 120, height: 120 },
  );
});

test('cropRegion: clamps to the bottom-right edges', () => {
  assert.deepEqual(
    cropRegion(1000, 500, { x: 900, y: 440, width: 100, height: 50 }),
    { x: 895, y: 435, width: 105, height: 60 },
  );
});

test('cropRegion: box larger than the bitmap yields the whole bitmap', () => {
  assert.deepEqual(
    cropRegion(1000, 500, { x: -50, y: -50, width: 2000, height: 2000 }),
    { x: 0, y: 0, width: 1000, height: 500 },
  );
});

// ── hasCard ──

test('hasCard', () => {
  assert.equal(hasCard(null), false);
  assert.equal(hasCard({}), false);
  assert.equal(hasCard({ cardNumber: '' }), false);
  assert.equal(hasCard({ cardNumber: '123' }), true);
});

// ── catalog invariants ──

test('catalog: 10 unique formats, each with exactly one render path', () => {
  assert.equal(CARD_FORMATS.length, 10);
  assert.equal(new Set(CARD_FORMATS.map(f => f.id)).size, 10);
  for (const f of CARD_FORMATS) {
    assert.notEqual(Boolean(f.jsBarcode), Boolean(f.displayOnly), `${f.id} must have exactly one render path`);
  }
});

test('catalog: scan list matches the catalog ids', () => {
  assert.deepEqual(SCAN_FORMATS, CARD_FORMATS.map(f => f.id));
});

// ── scanCardImage (fake detector / bitmap / canvas) ──

const saved = {};

function installScanFakes({ bitmap, results, throwOnDetect, throwOnCreateElement, onDrawImage }) {
  saved.createImageBitmap = globalThis.createImageBitmap;
  saved.BarcodeDetector = globalThis.BarcodeDetector;
  saved.document = globalThis.document;
  saved.consoleError = console.error;

  globalThis.createImageBitmap = async () => bitmap;
  globalThis.BarcodeDetector = class {
    constructor(opts) { globalThis.__detectorOpts = opts; }
    async detect() {
      if (throwOnDetect) throw new Error('boom');
      return results;
    }
  };
  globalThis.document = {
    createElement: () => {
      if (throwOnCreateElement) throw new Error('no canvas');
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: (...args) => onDrawImage?.(args) }),
        toDataURL: () => 'data:image/png;base64,FAKE',
      };
    },
  };
  console.error = () => {};
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  for (const key of Object.keys(saved)) delete saved[key];
  delete globalThis.__detectorOpts;
});

test('scanCardImage: success returns number, format, cropped image', async () => {
  const statuses = [];
  let drawArgs = null;
  installScanFakes({
    bitmap: { width: 1000, height: 500, close() {} },
    results: [{ rawValue: '123456789', format: 'ean_13', boundingBox: { x: 200, y: 100, width: 100, height: 50 } }],
    onDrawImage: args => { drawArgs = args; },
  });

  const res = await scanCardImage({}, { onStatus: s => statuses.push(s) });

  assert.deepEqual(res, { ok: true, number: '123456789', format: 'ean_13', image: 'data:image/png;base64,FAKE' });
  assert.deepEqual(statuses, ['Scanning…', '']);
  // pad = round(min(100,50) * 0.1) = 5 → x=195 y=95 w=110 h=60
  assert.deepEqual(drawArgs.slice(1), [195, 95, 110, 60, 0, 0, 110, 60]);
  assert.deepEqual(globalThis.__detectorOpts.formats, SCAN_FORMATS);
});

test('scanCardImage: no barcode → not-found, fields untouched by caller', async () => {
  const statuses = [];
  installScanFakes({ bitmap: { width: 10, height: 10, close() {} }, results: [] });

  const res = await scanCardImage({}, { onStatus: s => statuses.push(s) });

  assert.deepEqual(res, { ok: false, reason: 'not-found' });
  assert.equal(statuses[statuses.length - 1], 'No barcode found — try a clearer screenshot.');
});

test('scanCardImage: detector error → error', async () => {
  const statuses = [];
  installScanFakes({ bitmap: { width: 10, height: 10, close() {} }, results: [], throwOnDetect: true });

  const res = await scanCardImage({}, { onStatus: s => statuses.push(s) });

  assert.deepEqual(res, { ok: false, reason: 'error' });
  assert.equal(statuses[statuses.length - 1], 'Scan failed — enter the number manually below.');
});

test('scanCardImage: crop failure still returns the number without image', async () => {
  installScanFakes({
    bitmap: { width: 10, height: 10, close() {} },
    results: [{ rawValue: '123', format: 'code_128', boundingBox: { x: 0, y: 0, width: 5, height: 5 } }],
    throwOnCreateElement: true,
  });

  const res = await scanCardImage({});

  assert.deepEqual(res, { ok: true, number: '123', format: 'code_128', image: null });
});
