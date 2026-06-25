const CACHE = 'bolao-copa-v1';

// Assets to cache on install (shell + fonts)
const PRECACHE = [
  './bolao-copa.html',
  './icon.svg',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap'
];

// Never cache Supabase API calls — always fetch fresh data
function isApiCall(url) {
  return url.includes('supabase.co') || url.includes('/rest/v1/');
}

// Install: pre-cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   - API calls → network only (fresh data always)
//   - Everything else → cache first, fall back to network
self.addEventListener('fetch', e => {
  if (isApiCall(e.request.url)) {
    // Network only for Supabase
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful GET responses for future offline use
        if (e.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve the app shell
        if (e.request.mode === 'navigate') {
          return caches.match('./bolao-copa.html');
        }
      });
    })
  );
});
