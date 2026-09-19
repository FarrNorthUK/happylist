import { initRouter, onNavigate } from './router.js';
import { initList }               from './views/list.js';
import { initStores }             from './views/stores.js';
import { initShop, resetShopToGrid } from './views/shop.js';
import { initSettings, updateSyncStatus } from './views/settings.js';
import { flushSync }                      from './sync.js';
import { createUpdateChecker, fetchVersionFromNetwork } from './update.js';
import { ensureGeneralStore }             from './data.js';

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

// ── Launch migration: ensure the General store exists ──
ensureGeneralStore().catch(console.error);

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

// ── Sync badge ──
let _syncBadgeStart = 0;
let _syncBadgeTimer = null;

function setSyncBadge(state) {
  const dot = document.getElementById('nav-sync-dot');
  if (!dot) return;

  if (state === 'syncing') {
    clearTimeout(_syncBadgeTimer);
    _syncBadgeStart = Date.now();
    dot.classList.remove('hidden');
    dot.style.background = '#f59e0b';
  } else {
    const delay = Math.max(0, 600 - (Date.now() - _syncBadgeStart));
    clearTimeout(_syncBadgeTimer);
    _syncBadgeTimer = setTimeout(() => {
      if (state === 'ok') {
        dot.classList.add('hidden');
      } else {
        dot.classList.remove('hidden');
        dot.style.background = '#dc2626';
      }
    }, delay);
  }
}

window.addEventListener('happylist:sync-state', e => setSyncBadge(e.detail.state));

// happylist:mutated is fired after every local write
window.addEventListener('happylist:mutated', () => {
  pendingChanges = true;
  const dot = document.getElementById('nav-sync-dot');
  if (dot) {
    dot.classList.remove('hidden');
    dot.style.background = '#f59e0b';
  }
  if (navigator.onLine) scheduleSync();

  // Re-register Background Sync so Android Chrome can flush if app is closed
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(reg => reg.sync.register('happylist-sync').catch(() => {}));
  }
});

// ── Update check ──
const APP_VERSION = 'dev';

const updateChecker = createUpdateChecker({
  currentVersion: APP_VERSION,
  fetchVersion: fetchVersionFromNetwork,
});

export async function checkForUpdate() {
  const { updateAvailable } = await updateChecker.check();
  if (updateAvailable) {
    document.getElementById('update-banner')?.classList.remove('hidden');
  }
}

checkForUpdate();
