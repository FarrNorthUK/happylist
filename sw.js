const CACHE = 'happylist-v2';

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE }));
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Pass GitHub API requests straight through (never cache auth'd calls)
  if (url.hostname === 'api.github.com') return;

  // Never cache version file — always fetch fresh for update checks
  if (url.pathname.endsWith('/version.json')) return;

  // Network-first with cache: 'reload' to bypass the browser HTTP cache.
  // The SW becomes the single source of truth for offline support; live
  // requests always go to origin so updates apply immediately.
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request, { cache: 'reload' });
      if (res?.status === 200 && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    } catch {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (e.request.mode === 'navigate') return caches.match('/index.html');
      throw new Error('offline and no cache available');
    }
  })());
});

// Background Sync — triggered when network reconnects on Android Chrome
self.addEventListener('sync', e => {
  if (e.tag === 'happylist-sync') {
    e.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const all = await self.clients.matchAll({ type: 'window' });
  if (all.length > 0) {
    all.forEach(c => c.postMessage({ type: 'BG_SYNC' }));
    return;
  }
  // No open window — can't sync without IndexedDB access from SW in this setup.
  // Sync will happen on next app open.
}
