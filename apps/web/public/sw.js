/*
 * Offline shell for Night Shift Companion.
 * - Navigations: network first, cached app shell when offline.
 * - Hashed build assets (/assets/*) and uploaded images (/u/*): cache first (immutable).
 * - Other static files: stale-while-revalidate.
 * - Never cached: /api/*, /ws, /health (live data).
 * The build id arrives as ?v=… on the script URL; a new build installs a new
 * worker, which waits until the page asks it to take over (update prompt).
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const SHELL = `nsc-shell-${VERSION}`;
const RUNTIME = `nsc-runtime-${VERSION}`;
const UPLOADS = 'nsc-uploads';
const SHELL_FILES = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => undefined));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME, UPLOADS]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(name)).put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname === '/health' || url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put('/', res.clone());
        return res;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(req, RUNTIME)); return; }
  if (url.pathname.startsWith('/u/')) { event.respondWith(cacheFirst(req, UPLOADS)); return; }
  event.respondWith(staleWhileRevalidate(req));
});
