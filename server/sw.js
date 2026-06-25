// Service worker minimale e prudente.
// Obiettivi: UI utilizzabile offline e meno egress (ogni asset/thumbnail
// scaricato una volta sola per device). NON intercetta lo streaming audio
// (range request): quello lo gestisce la cache HTTP con Cache-Control immutable,
// così non si rischia di rompere la riproduzione a byte-range.
const CACHE = 'dnd-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // API e WebSocket: sempre dalla rete
  if (url.pathname.startsWith('/api') || url.pathname === '/ws') return
  // Audio in streaming (range): non intercettare, lascia la cache HTTP
  if (url.pathname.startsWith('/media/') && req.headers.has('range')) return

  // Shell, asset buildati, thumbnail: cache-first
  const cacheable =
    url.pathname === '/' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/media/')

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req)
      if (hit) return hit
      const resp = await fetch(req)
      if (resp.ok && cacheable) cache.put(req, resp.clone())
      return resp
    })
  )
})
