import db, { getSyncMeta, setSyncMeta, now } from './db.js';

const TABLES      = ['stores', 'categories', 'items', 'shoppingRuns', 'checkedItems'];
const FILE        = 'happylist-data.json';
const BACKUP_DIR  = 'backups';
const MAX_BACKUPS = 10;

let isSyncing = false;

/**
 * Main sync entry point.
 * @param {boolean} testOnly - if true, just verify credentials; do not merge data
 * @returns {{ ok: boolean, message: string }}
 */
export async function flushSync(testOnly = false, forcePush = false) {
  const repo = await getSyncMeta('ghRepo');
  const pat  = await getSyncMeta('ghPat');

  if (!repo || !pat) {
    return { ok: false, message: 'GitHub repo and PAT not configured. Go to Settings → Sync.' };
  }
  if (isSyncing) return { ok: true, message: 'Sync already in progress.' };

  isSyncing = true;
  setSyncBadge('syncing');

  try {
    const result = await doSync(repo, pat, testOnly, forcePush);
    if (result.ok) {
      await setSyncMeta('lastSyncedAt', now());
      setSyncBadge('ok');
      // Notify settings view if open
      window.dispatchEvent(new CustomEvent('happylist:synced'));
    } else {
      setSyncBadge('error');
    }
    return result;
  } catch (e) {
    console.error('[sync]', e);
    setSyncBadge('error');
    return { ok: false, message: e.message };
  } finally {
    isSyncing = false;
  }
}

async function doSync(repo, pat, testOnly, forcePush = false) {
  const headers = {
    Authorization: `token ${pat}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const url = `https://api.github.com/repos/${repo}/contents/${FILE}`;

  // ── Step 1: GET current file from GitHub ──
  let remoteSha = null;
  let remoteData = null;

  const getRes = await fetch(url, { headers });

  if (getRes.status === 404) {
    // File doesn't exist yet — first sync, we'll create it
    remoteData = { version: 1, stores: [], categories: [], items: [], shoppingRuns: [], checkedItems: [] };
  } else if (getRes.status === 401 || getRes.status === 403) {
    return { ok: false, message: 'Authentication failed. Check your Personal Access Token.' };
  } else if (!getRes.ok) {
    return { ok: false, message: `GitHub API error: ${getRes.status} ${getRes.statusText}` };
  } else {
    const json = await getRes.json();
    remoteSha = json.sha;
    remoteData = JSON.parse(atob(json.content.replace(/\n/g, '')));
  }

  if (testOnly) return { ok: true, message: 'Connection successful.' };

  const today = new Date().toISOString().slice(0, 10);
  const lastBackup = await getSyncMeta('lastBackupAt');
  const needsBackup = lastBackup !== today;

  // ── Step 2: Merge remote data into local IndexedDB ──
  if (!forcePush) {
    await mergeRemoteIntoLocal(remoteData);
  }

  // ── Step 3: Build merged payload from current local state ──
  const payload = await buildPayload();

  // ── Step 4: PUT updated file back to GitHub ──
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
  const body = { message: 'Happy List sync', content };
  if (remoteSha) body.sha = remoteSha;

  const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });

  if (putRes.status === 409) {
    // SHA mismatch — another device updated the file concurrently; retry once
    return doSync(repo, pat, false, forcePush);
  }
  if (!putRes.ok) {
    return { ok: false, message: `GitHub write error: ${putRes.status} ${putRes.statusText}` };
  }

  // Store new SHA for next sync
  const putJson = await putRes.json();
  await setSyncMeta('githubSha', putJson.content?.sha ?? null);

  // Write daily backup on first sync of each calendar date (post-merge state)
  if (needsBackup) await maybeWriteDailyBackup(repo, pat, headers, today, payload);

  return { ok: true, message: 'Sync complete.' };
}

async function maybeWriteDailyBackup(repo, pat, headers, today, snapshot) {
  const backupUrl = `https://api.github.com/repos/${repo}/contents/${BACKUP_DIR}/${today}.json`;

  // If a backup already exists on GitHub for today, just record it locally and skip
  const checkRes = await fetch(backupUrl, { headers });
  if (checkRes.ok) {
    await setSyncMeta('lastBackupAt', today);
    return;
  }

  const content = btoa(unescape(encodeURIComponent(JSON.stringify(snapshot, null, 2))));
  const putRes = await fetch(backupUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message: 'Happy List daily backup', content }),
  });

  if (putRes.ok) {
    await setSyncMeta('lastBackupAt', today);
    await pruneBackups(repo, pat, headers);
  }
}

async function pruneBackups(repo, pat, headers) {
  const listRes = await fetch(`https://api.github.com/repos/${repo}/contents/${BACKUP_DIR}`, { headers });
  if (!listRes.ok) return;
  const files = await listRes.json();
  if (!Array.isArray(files) || files.length <= MAX_BACKUPS) return;

  files.sort((a, b) => a.name.localeCompare(b.name));
  const toDelete = files.slice(0, files.length - MAX_BACKUPS);
  for (const file of toDelete) {
    await fetch(`https://api.github.com/repos/${repo}/contents/${BACKUP_DIR}/${file.name}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ message: 'Happy List backup cleanup', sha: file.sha }),
    });
  }
}

export async function listBackups() {
  const repo = await getSyncMeta('ghRepo');
  const pat  = await getSyncMeta('ghPat');
  if (!repo || !pat) return { ok: false, message: 'Sync not configured.', backups: [] };

  const headers = { Authorization: `token ${pat}`, Accept: 'application/vnd.github+json' };
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${BACKUP_DIR}`, { headers });

  if (res.status === 404) return { ok: true, backups: [] };
  if (!res.ok) return { ok: false, message: `GitHub error: ${res.status}`, backups: [] };

  const files = await res.json();
  if (!Array.isArray(files)) return { ok: true, backups: [] };

  const backups = files
    .filter(f => f.name.endsWith('.json'))
    .map(f => ({ filename: f.name, date: f.name.replace('.json', ''), sha: f.sha, url: f.url }))
    .sort((a, b) => b.date.localeCompare(a.date));

  return { ok: true, backups };
}

export async function restoreBackup(filename) {
  const repo = await getSyncMeta('ghRepo');
  const pat  = await getSyncMeta('ghPat');
  if (!repo || !pat) return { ok: false, message: 'Sync not configured.' };

  const headers = { Authorization: `token ${pat}`, Accept: 'application/vnd.github+json' };
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${BACKUP_DIR}/${filename}`, { headers });
  if (!res.ok) return { ok: false, message: `Could not fetch backup: ${res.status}` };

  const json = await res.json();
  const data = JSON.parse(atob(json.content.replace(/\n/g, '')));
  return restoreFromData(data);
}

export async function restoreFromData(data) {
  for (const table of TABLES) {
    await db[table].clear();
    if (data[table]?.length) await db[table].bulkPut(data[table]);
  }
  return flushSync(false, true);
}

async function mergeRemoteIntoLocal(remoteData) {
  for (const table of TABLES) {
    const remoteRows = remoteData[table] ?? [];
    for (const remote of remoteRows) {
      const local = await db[table].get(remote.id);
      if (!local) {
        // New record from remote — add it
        await db[table].put(remote);
      } else {
        // Keep whichever has the more recent updatedAt
        const localTs  = new Date(local.updatedAt  || 0).getTime();
        const remoteTs = new Date(remote.updatedAt || 0).getTime();
        if (remoteTs > localTs) {
          await db[table].put(remote);
        }
      }
    }
  }
}

async function buildPayload() {
  const payload = { version: 1, lastModified: now() };
  for (const table of TABLES) {
    payload[table] = await db[table].toArray();
  }
  return payload;
}

// ── Sync badge helpers ──
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

export function markPendingSync() {
  const dot = document.getElementById('nav-sync-dot');
  if (dot) {
    dot.classList.remove('hidden');
    dot.style.background = '#f59e0b';
  }
}
