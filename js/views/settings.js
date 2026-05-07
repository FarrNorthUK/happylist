import db, { now, getSyncMeta, setSyncMeta } from '../db.js';
import { flushSync, listBackups, restoreBackup, restoreFromData } from '../sync.js';
import { checkForUpdate } from '../app.js';
import { showConfirm } from '../confirm.js';

let deferredInstallPrompt = null;

export function initSettings() {
  loadSyncConfig();
  updateSyncStatus();
  checkStorage();
  loadSwVersion();

  // Sync config
  document.getElementById('btn-test-sync').onclick = testSync;
  document.getElementById('btn-toggle-pat').onclick = togglePat;
  document.getElementById('btn-manual-sync').onclick = manualSync;
  document.getElementById('btn-open-creds').onclick = openCredsModal;
  document.getElementById('btn-close-creds').onclick = closeCredsModal;
  document.querySelector('#modal-creds .modal-backdrop').onclick = closeCredsModal;

  // Storage
  document.getElementById('btn-persist').onclick = requestPersist;

  // Stores list modal
  document.getElementById('btn-manage-stores').onclick = openStoresListModal;
  document.getElementById('btn-close-stores-list').onclick = closeStoresListModal;
  document.getElementById('stores-list-backdrop').onclick = closeStoresListModal;

  // Export / Backup
  document.getElementById('btn-export').onclick = exportData;
  document.getElementById('btn-open-backups').onclick = openBackupModal;
  document.getElementById('btn-import-json').onclick = () =>
    document.getElementById('input-restore-json').click();
  document.getElementById('input-restore-json').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const errEl = document.getElementById('import-error');
    errEl.textContent = '';
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { errEl.textContent = 'Could not read file — is it a valid Happy List JSON export?'; return; }
    const confirmed = await showConfirm(
      `Restore from "${file.name}"? Your current data will be saved locally first as a safety backup.`,
      { confirmText: 'Restore' }
    );
    if (!confirmed) return;
    await downloadCurrentData();
    const { ok, message } = await restoreFromData(data);
    if (!ok) errEl.textContent = `Restore failed: ${message}`;
  };
  document.getElementById('btn-close-backups').onclick = closeBackupModal;
  document.querySelector('#modal-backups .modal-backdrop').onclick = closeBackupModal;

  // Install
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('install-section').classList.remove('hidden');
  });
  document.getElementById('btn-install').onclick = () => {
    deferredInstallPrompt?.prompt();
    deferredInstallPrompt = null;
    document.getElementById('install-section').classList.add('hidden');
  };
}

export function updateSyncStatus() {
  getSyncMeta('lastSyncedAt').then(ts => {
    const el = document.getElementById('sync-status-text');
    if (!ts) {
      el.textContent = 'Never synced.';
      return;
    }
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    let ago;
    if (diff < 10)        ago = 'just now';
    else if (diff < 60)   ago = `${diff} seconds ago`;
    else if (diff < 3600) ago = `${Math.floor(diff / 60)} minutes ago`;
    else if (diff < 86400)ago = `${Math.floor(diff / 3600)} hours ago`;
    else                  ago = new Date(ts).toLocaleDateString();
    el.textContent = `Last synced: ${ago}`;
  });
}

async function manualSync() {
  const btn = document.getElementById('btn-manual-sync');
  const status = document.getElementById('sync-status-text');
  btn.textContent = 'Syncing…';
  btn.disabled = true;
  status.textContent = 'Syncing…';
  const { ok, message } = await flushSync();
  btn.textContent = 'Sync now';
  btn.disabled = false;
  if (ok) updateSyncStatus();
  else status.textContent = `Sync failed: ${message}`;
  checkForUpdate();
}

async function loadSyncConfig() {
  const [repo, pat] = await Promise.all([
    getSyncMeta('ghRepo'),
    getSyncMeta('ghPat'),
  ]);
  document.getElementById('gh-repo').value = repo ?? '';
  document.getElementById('gh-pat').value = pat ?? '';
}

async function saveSyncConfig() {
  const repo = document.getElementById('gh-repo').value.trim();
  const pat  = document.getElementById('gh-pat').value.trim();
  await setSyncMeta('ghRepo', repo);
  await setSyncMeta('ghPat', pat);
  document.getElementById('sync-test-result').textContent = 'Saved.';
  setTimeout(() => { document.getElementById('sync-test-result').textContent = ''; }, 2000);
}

async function testSync() {
  const result = document.getElementById('sync-test-result');
  result.textContent = 'Testing…';
  try {
    await saveSyncConfig();
    const test = await flushSync(true);
    if (!test.ok) {
      result.textContent = `✗ ${test.message}`;
      return;
    }
    result.textContent = '✓ Saved — syncing…';
    const sync = await flushSync();
    if (sync.ok) {
      updateSyncStatus();
      result.textContent = '✓ Saved & synced!';
      setTimeout(closeCredsModal, 800);
    } else {
      result.textContent = `Saved, but sync failed: ${sync.message}`;
    }
  } catch (e) {
    result.textContent = `✗ ${e.message}`;
  }
}

function openCredsModal() {
  loadSyncConfig();
  document.getElementById('sync-test-result').textContent = '';
  document.getElementById('modal-creds').classList.remove('hidden');
}

function closeCredsModal() {
  document.getElementById('modal-creds').classList.add('hidden');
}

function togglePat() {
  const input = document.getElementById('gh-pat');
  const btn = document.getElementById('btn-toggle-pat');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? 'Hide' : 'Show';
}

async function checkStorage() {
  const el = document.getElementById('storage-status');
  if (!navigator.storage) {
    el.textContent = 'Storage API not available in this browser.';
    return;
  }
  const persisted = await navigator.storage.persisted();
  el.textContent = persisted
    ? '✓ Persistent storage granted — data will not be evicted.'
    : 'Storage is not persistent. Tap the button below to request it.';
}

async function requestPersist() {
  const granted = await navigator.storage.persist();
  document.getElementById('storage-status').textContent = granted
    ? '✓ Persistent storage granted!'
    : 'Request denied — data may be evicted under disk pressure.';
}

async function downloadCurrentData() {
  const [stores, items, shoppingRuns, checkedItems] = await Promise.all([
    db.stores.toArray(),
    db.items.toArray(),
    db.shoppingRuns.toArray(),
    db.checkedItems.toArray(),
  ]);
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: now(), stores, items, shoppingRuns, checkedItems }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `happylist-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportData() { await downloadCurrentData(); }

async function openBackupModal() {
  const content = document.getElementById('backup-list-content');
  content.innerHTML = '<p class="settings-hint">Loading…</p>';
  document.getElementById('modal-backups').classList.remove('hidden');

  const { ok, backups, message } = await listBackups();

  if (!ok) {
    content.innerHTML = `<p class="settings-hint">Error: ${message}</p>`;
    return;
  }
  if (!backups.length) {
    content.innerHTML = '<p class="settings-hint">No backups yet. A backup is created automatically each day you sync.</p>';
    return;
  }

  content.innerHTML = '';
  backups.forEach(({ filename, date }) => {
    const row = document.createElement('div');
    row.className = 'backup-row';
    row.innerHTML = `
      <span class="backup-date">${date}</span>
      <button class="secondary-btn btn-restore-backup" data-file="${filename}">Restore</button>`;
    content.appendChild(row);
  });

  content.querySelectorAll('.btn-restore-backup').forEach(btn => {
    btn.onclick = async () => {
      const confirmed = await showConfirm(
        'Restore this backup? Your current data will be saved locally first as a safety backup.',
        { confirmText: 'Restore' }
      );
      if (!confirmed) return;
      btn.textContent = 'Restoring…';
      btn.disabled = true;
      await downloadCurrentData();
      const { ok, message } = await restoreBackup(btn.dataset.file);
      if (ok) {
        btn.textContent = '✓ Restored';
        setTimeout(closeBackupModal, 800);
      } else {
        btn.textContent = 'Restore';
        btn.disabled = false;
        document.getElementById('backup-error').textContent = `Failed: ${message}`;
      }
    };
  });
}

function closeBackupModal() {
  document.getElementById('modal-backups').classList.add('hidden');
  document.getElementById('backup-error').textContent = '';
}

function openStoresListModal()  { document.getElementById('modal-stores-list').classList.remove('hidden'); }
function closeStoresListModal() { document.getElementById('modal-stores-list').classList.add('hidden'); }

async function loadSwVersion() {
  const el = document.getElementById('sw-version');
  if (!el || !('caches' in window)) return;
  const keys = await caches.keys();
  el.textContent = keys[0] ?? '';
}

