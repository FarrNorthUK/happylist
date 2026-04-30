import { initRouter, onNavigate } from './router.js';
import { initList }               from './views/list.js';
import { initStores }             from './views/stores.js';
import { initShop, resetShopToGrid } from './views/shop.js';
import { initSettings, updateSyncStatus } from './views/settings.js';
import { flushSync, markPendingSync }     from './sync.js';

// ── Service Worker registration ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    if ('SyncManager' in window) {
      reg.sync.register('happylist-sync').catch(() => {});
    }
  }).catch(console.error);

  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'BG_SYNC') {
      flushSync().then(updateSyncStatus);
    }
  });
}

// ── Request persistent storage on first run ──
(async () => {
  if (navigator.storage?.persisted) {
    const persisted = await navigator.storage.persisted();
    if (!persisted) navigator.storage.persist();
  }
})();

// ── Init views ──
initRouter();
initList();
initStores();
initShop();
initSettings();

// ── Navigate callbacks ──
onNavigate('shop', resetShopToGrid);
onNavigate('settings', updateSyncStatus);

// ── Debounced auto-sync (data only — no update check) ──
let syncTimer = null;
let pendingChanges = false;

function scheduleSync(delay = 3000) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const { ok } = await flushSync();
    if (ok) {
      pendingChanges = false;
      updateSyncStatus();
    }
  }, delay);
}

// ── Offline / online banner ──
function updateOnlineState() {
  document.getElementById('offline-banner').classList.toggle('hidden', navigator.onLine);
  if (navigator.onLine && pendingChanges) scheduleSync();
}
window.addEventListener('online',  updateOnlineState);
window.addEventListener('offline', updateOnlineState);
updateOnlineState();

// happylist:mutated is fired after every local write
window.addEventListener('happylist:mutated', () => {
  pendingChanges = true;
  markPendingSync();
  if (navigator.onLine) scheduleSync();

  // Re-register Background Sync so Android Chrome can flush if app is closed
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(reg => reg.sync.register('happylist-sync').catch(() => {}));
  }
});

// ── Update check ──
const APP_VERSION = 'dev';

export async function checkForUpdate() {
  if (APP_VERSION === 'dev') return;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'reload' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version && version !== APP_VERSION) {
      document.getElementById('update-banner')?.classList.remove('hidden');
    }
  } catch (err) {
    console.warn('[update-check] failed:', err);
  }
}

checkForUpdate();
