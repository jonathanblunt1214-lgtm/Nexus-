// Smoke Stack Pitmaster - Progressive Web App & Cross-Format Service Worker
const CACHE_NAME = 'smokestack-shell-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Vite's dev server owns these paths entirely for HMR/module-reload to
  // work - the service worker must never touch them. Returning here without
  // calling event.respondWith() lets the request pass straight through as
  // if this service worker didn't exist for it. Without this, the SW's own
  // fetch/cache logic below conflicts with Vite's dev-mode request handling
  // and can cause "Failed to fetch" errors on these paths (only in dev -
  // this doesn't affect the production build, which has none of these).
  if (
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@react-refresh') ||
    url.pathname.startsWith('/@id/') ||
    url.pathname.startsWith('/@fs/') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/.vite/') ||
    url.search.includes('t=') // Vite's cache-busting query param on hot-updated modules
  ) {
    return;
  }

  // Navigation strategy: Network first with cache fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // Never cache release metadata; installed clients must see the deployment's
  // current build before deciding whether to refresh.
  if (url.pathname === '/version.json') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Stale-while-revalidate for immutable, content-hashed static assets.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {/* Silent offline fallback */});
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});

// Background Push Notification Event Handling for Mobile PWAs and Browsers
self.addEventListener('push', (event) => {
  let data = {
    title: '🔥 Smoke Stack Alert',
    body: 'Time to check internal meat temperature & pit status!',
  };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 400],
    data: data.url || '/',
    actions: [
      { action: 'open_app', title: 'Open Smoke Log' },
      { action: 'snooze', title: 'Snooze 10m' }
    ],
    requireInteraction: true,
  };
  event.waitUntil(
    self.registration.showNotification(data.title || '🔥 Smoke Stack Reminder', options)
  );
});

// Handle Notification Clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open_app' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data || '/');
        }
      })
    );
  }
});
