import db, { getSyncMeta, setSyncMeta, now } from './db.js';
import { importTableAsLatest, archiveRowsAsLatest, putRowAsIs } from './data.js';

const TABLES = ['stores', 'items', 'shoppingRuns', 'checkedItems'];
const FILE = 'happylist-data.json';
const BACKUP_DIR = 'backups';
const MAX_BACKUPS = 10;
const MAX_CONFLICT_RETRIES = 2;

// ── GitHub transport adapter (production) ──
// The engine works in plain JSON objects; the adapter owns auth headers,
// base64 encoding, and URL construction.

function githubTransport(repo, pat) {
  const headers = {
    Authorization: `token ${pat}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const url = path => `https://api.github.com/repos/${repo}/contents/${path}`;

  return {
    async getFile(path) {
      const res = await fetch(url(path), { headers });
      if (res.status === 404) return { status: 404 };
      if (res.status === 403) {
        return { status: 403, rateLimited: res.headers.get('x-ratelimit-remaining') === '0' };
      }
      if (!res.ok) return { status: res.status };
      const json = await res.json();
      return { status: 200, sha: json.sha, data: JSON.parse(atob(json.content.replace(/\n/g, ''))) };
    },

    async putFile(path, { sha, data, message }) {
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
      const body = { message, content };
      if (sha) body.sha = sha;
      const res = await fetch(url(path), { method: 'PUT', headers, body: JSON.stringify(body) });
      if (!res.ok) return { status: res.status };
      const json = await res.json();
      return { status: 200, sha: json.content?.sha ?? null };
    },

    async listDir(path) {
      const res = await fetch(url(path), { headers });
      if (!res.ok) return { status: res.status };
      const files = await res.json();
      return { status: 200, files: Array.isArray(files) ? files.map(f => ({ name: f.name, sha: f.sha })) : [] };
    },

    async deleteFile(path, { sha, message }) {
      const res = await fetch(url(path), {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ message, sha }),
      });
      return { status: res.status };
    },
  };
}

// ── Engine ──

export function createSync({ makeTransport }) {
  let inFlight = null; // { kind: 'sync' | 'restore', promise }

  // Serializes all round-trips and restores. Concurrent plain syncs
  // coalesce into the in-flight one; restores always queue their own op.
  function withLock(kind, op) {
    if (kind === 'sync' && inFlight?.kind === 'sync') {
      return inFlight.promise;
    }
    const prev = inFlight ? inFlight.promise.catch(() => {}) : Promise.resolve();
    const promise = prev.then(op).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { kind, promise };
    return promise;
  }

  function fireState(state) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('happylist:sync-state', { detail: { state } }));
    }
  }

  async function getCredentials() {
    const [repo, pat] = await Promise.all([
      getSyncMeta('ghRepo'),
      getSyncMeta('ghPat'),
    ]);
    return { repo, pat };
  }

  function notConfigured() {
    return { ok: false, message: 'GitHub repo and PAT not configured. Go to Settings → Sync.' };
  }

  function errorMessage(status, rateLimited = false) {
    if (status === 401) return 'Authentication failed. Check your Personal Access Token.';
    if (status === 403 && rateLimited) return 'GitHub rate limit hit — try again in a few minutes.';
    if (status === 403) return 'Access denied — check the PAT has content access to the repo.';
    return `GitHub API error: ${status}`;
  }

  async function doSync(transport, forcePush) {
    for (let attempt = 0; ; attempt++) {
      const got = await transport.getFile(FILE);
      if (got.status !== 200 && got.status !== 404) {
        return { ok: false, message: errorMessage(got.status, got.rateLimited) };
      }

      const remoteSha = got.sha ?? null;
      const remoteData = got.data ?? { version: 1, stores: [], items: [], shoppingRuns: [], checkedItems: [] };

      if (!forcePush) await mergeRemoteIntoLocal(remoteData);

      const payload = await buildPayload();

      const put = await transport.putFile(FILE, { sha: remoteSha, data: payload, message: 'Happy List sync' });
      if (put.status === 409) {
        if (attempt >= MAX_CONFLICT_RETRIES) {
          return { ok: false, message: 'Sync conflict — another device is syncing. Try again.' };
        }
        continue;
      }
      if (put.status !== 200) {
        return { ok: false, message: `GitHub write error: ${put.status}` };
      }

      const today = new Date().toISOString().slice(0, 10);
      if ((await getSyncMeta('lastBackupAt')) !== today) {
        await maybeWriteDailyBackup(transport, today, payload);
      }

      return { ok: true, message: 'Sync complete.' };
    }
  }

  async function flushSync(testOnly = false, forcePush = false) {
    const { repo, pat } = await getCredentials();
    if (!repo || !pat) return notConfigured();

    if (testOnly) {
      const got = await makeTransport(repo, pat).getFile(FILE);
      if (got.status === 200 || got.status === 404) return { ok: true, message: 'Connection successful.' };
      return { ok: false, message: errorMessage(got.status, got.rateLimited) };
    }

    return withLock('sync', async () => {
      fireState('syncing');
      try {
        const result = await doSync(makeTransport(repo, pat), forcePush);
        if (result.ok) {
          await setSyncMeta('lastSyncedAt', now());
          fireState('ok');
        } else {
          fireState('error');
        }
        return result;
      } catch (e) {
        console.error('[sync]', e);
        fireState('error');
        return { ok: false, message: e.message };
      }
    });
  }

  async function listBackups() {
    const { repo, pat } = await getCredentials();
    if (!repo || !pat) return { ok: false, message: 'Sync not configured.', backups: [] };

    const list = await makeTransport(repo, pat).listDir(BACKUP_DIR);
    if (list.status === 404) return { ok: true, backups: [] };
    if (list.status !== 200) return { ok: false, message: `GitHub error: ${list.status}`, backups: [] };

    const backups = list.files
      .filter(f => f.name.endsWith('.json'))
      .map(f => ({ filename: f.name, date: f.name.replace('.json', '') }))
      .sort((a, b) => b.date.localeCompare(a.date));
    return { ok: true, backups };
  }

  async function restoreBackup(filename) {
    const { repo, pat } = await getCredentials();
    if (!repo || !pat) return { ok: false, message: 'Sync not configured.' };

    const got = await makeTransport(repo, pat).getFile(`${BACKUP_DIR}/${filename}`);
    if (got.status !== 200) return { ok: false, message: `Could not fetch backup: ${got.status}` };
    return restoreFromData(got.data);
  }

  async function restoreFromData(data) {
    const { repo, pat } = await getCredentials();
    if (!repo || !pat) return notConfigured();

    return withLock('restore', async () => {
      fireState('syncing');
      let localChanged = false;
      try {
        const transport = makeTransport(repo, pat);

        const live = await transport.getFile(FILE);
        if (live.status !== 200 && live.status !== 404) {
          return { ok: false, message: errorMessage(live.status, live.rateLimited) };
        }

        // Live rows missing from the backup are archived (stamped) so the
        // restore is a full replacement on every device, not just a merge.
        const liveRows = live.data ?? {};
        const toArchive = {};
        for (const table of TABLES) {
          const ids = new Set((data[table] ?? []).map(r => r.id));
          toArchive[table] = (liveRows[table] ?? []).filter(r => !ids.has(r.id));
        }

        await db.transaction('rw', db.stores, db.items, db.shoppingRuns, db.checkedItems, async () => {
          for (const table of TABLES) {
            await importTableAsLatest(table, data[table] ?? []);
            await archiveRowsAsLatest(table, toArchive[table]);
          }
        });
        localChanged = true;

        const result = await doSync(transport, true);
        if (result.ok) {
          await setSyncMeta('lastSyncedAt', now());
          fireState('ok');
        } else {
          fireState('error');
          return { ...result, localChanged: true };
        }
        return result;
      } catch (e) {
        console.error('[sync]', e);
        fireState('error');
        return { ok: false, message: e.message, localChanged };
      }
    });
  }

  return { flushSync, listBackups, restoreBackup, restoreFromData };
}

// ── Shared helpers (db singleton) ──

async function mergeRemoteIntoLocal(remoteData) {
  for (const table of TABLES) {
    const remoteRows = remoteData[table] ?? [];
    for (const remote of remoteRows) {
      const local = await db[table].get(remote.id);
      if (!local) {
        await putRowAsIs(table, remote);
      } else {
        const localTs = new Date(local.updatedAt || 0).getTime();
        const remoteTs = new Date(remote.updatedAt || 0).getTime();
        if (remoteTs > localTs) {
          await putRowAsIs(table, remote);
        }
      }
    }
  }
}

async function buildPayload() {
  const rows = await db.transaction('r', db.stores, db.items, db.shoppingRuns, db.checkedItems, () =>
    Promise.all(TABLES.map(t => db[t].toArray()))
  );
  const payload = { version: 1, lastModified: now() };
  rows.forEach((tableRows, i) => { payload[TABLES[i]] = tableRows; });
  return payload;
}

async function maybeWriteDailyBackup(transport, today, snapshot) {
  const backupPath = `${BACKUP_DIR}/${today}.json`;
  const check = await transport.getFile(backupPath);
  if (check.status === 200) {
    await setSyncMeta('lastBackupAt', today);
    return;
  }
  const put = await transport.putFile(backupPath, { data: snapshot, message: 'Happy List daily backup' });
  if (put.status === 200) {
    await setSyncMeta('lastBackupAt', today);
    await pruneBackups(transport);
  }
}

async function pruneBackups(transport) {
  const list = await transport.listDir(BACKUP_DIR);
  if (list.status !== 200 || list.files.length <= MAX_BACKUPS) return;
  const files = [...list.files].sort((a, b) => a.name.localeCompare(b.name));
  const toDelete = files.slice(0, files.length - MAX_BACKUPS);
  for (const file of toDelete) {
    await transport.deleteFile(`${BACKUP_DIR}/${file.name}`, { sha: file.sha, message: 'Happy List backup cleanup' });
  }
}

// ── Production instance ──

const engine = createSync({ makeTransport: githubTransport });

export const { flushSync, listBackups, restoreBackup, restoreFromData } = engine;
