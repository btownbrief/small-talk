// SMALL TALK — service worker: push notifications + a tiny offline shell.
// Network-first for everything (this is a live app); the shell caches only
// so an offline open shows the page instead of a browser error.
const SHELL = 'st-shell-v2';
const SHELL_FILES = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/core.js', 'js/net.js', 'js/fake-backend.js', 'data/places.json', 'data/questions.json', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  // cache only the shell files (plus the app root itself) — never mod.html, data feeds, or query-string variants
  const u = new URL(e.request.url); const isRoot = u.pathname.endsWith('/') && !u.search;
  const isShell = isRoot || SHELL_FILES.some((f) => f !== './' && u.pathname.endsWith('/' + f) && !u.search);
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && isShell) caches.open(SHELL).then((c) => c.put(e.request, r.clone())).catch(() => {}); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))));
});

self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Small Talk', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Small Talk';
  const opts = { body: d.body || 'Something new for you.', icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', tag: d.tag || 'st', data: { url: d.url || './' } };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => { for (const c of cs) if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url); return c.focus(); } return self.clients.openWindow(url); }));
});
