// Service worker: makes the app installable, opens even when offline,
// and receives push notifications.
// Attendance data (/api) is NEVER cached, so numbers are always live.
const VERSION = 'v10';
const PAGES = `pages-${VERSION}`;
const FONTS = 'fonts-v1';
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/badge-96.png', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(PAGES).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [PAGES, FONTS];
    for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: keep a copy so the app looks right offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONTS).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live

  // Pages and files: try the network first (so updates show at once),
  // fall back to the last saved copy, then to the offline page.
  event.respondWith((async () => {
    const cache = await caches.open(PAGES);
    const key = req.mode === 'navigate' ? url.pathname : req;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(key, { ignoreSearch: req.mode !== 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('/offline.html')) || Response.error();
      return Response.error();
    }
  })());
});

// ---------- Push notifications ----------
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Attendance', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Attendance';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
    vibrate: [80, 40, 80]
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const samePage = wins.find(w => new URL(w.url).pathname === new URL(url).pathname);
    if (samePage) {
      await samePage.focus();
      if (samePage.url !== url && 'navigate' in samePage) samePage.navigate(url).catch(() => {});
      return;
    }
    await self.clients.openWindow(url);
  })());
});
