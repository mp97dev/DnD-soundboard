// Service worker minimale e prudente.
// Obiettivi: UI utilizzabile offline e meno egress (ogni asset/thumbnail
// scaricato una volta sola per device). NON intercetta lo streaming audio
// (range request): quello lo gestisce la cache HTTP con Cache-Control immutable,
// così non si rischia di rompere la riproduzione a byte-range.
//
// STORIA: la v1 serviva ANCHE la shell ('/') cache-first, e non ripuliva mai la
// cache. La shell è l'unico file che nomina gli asset buildati, che hanno
// l'hash nel nome: una shell vecchia punta per sempre agli asset vecchi, e
// quelli stanno nella stessa cache. Risultato: il browser restava inchiodato
// alla PRIMA build che aveva visto — ricompilare, ricaricare e perfino il
// reload forzato (Ctrl+Shift+R) continuavano a servire il vecchio bundle,
// perché a rispondere non era la rete ma questo file. Misurato: un Brave
// aperto a luglio serviva ancora il renderer di luglio a fine agosto, cioè
// senza nessuna delle correzioni di interfaccia arrivate nel frattempo.
//
// Regola d'ora in poi:
//   shell/navigazioni -> RETE per prima, la cache è solo il ripiego offline.
//   /assets/          -> cache-first, ma è sicuro: il nome contiene l'hash del
//                        contenuto, quindi una build nuova chiede nomi nuovi.
//   /media/           -> cache-first: i file sono content-addressed (ytId).
const VERSION = 'v2'
const CACHE = `dnd-shell-${VERSION}`

self.addEventListener('install', () => self.skipWaiting())

// Le cache delle versioni precedenti vanno buttate, non solo ignorate: è lì che
// stava la shell vecchia, e finché esiste qualcuno può ripescarla.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })()
  )
})

// Rete con ripiego sulla cache. La copia in cache si aggiorna a ogni risposta
// buona, così l'ultima build vista resta disponibile offline.
async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const resp = await fetch(req)
    if (resp.ok) cache.put(req, resp.clone())
    return resp
  } catch (err) {
    const hit = await cache.match(req)
    if (hit) return hit
    throw err
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  const resp = await fetch(req)
  if (resp.ok) cache.put(req, resp.clone())
  return resp
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return

  // API e WebSocket: sempre dalla rete
  if (url.pathname.startsWith('/api') || url.pathname === '/ws') return
  // Audio in streaming (range): non intercettare, lascia la cache HTTP
  if (url.pathname.startsWith('/media/') && req.headers.has('range')) return

  // La shell arriva come richiesta di navigazione, e il server la serve su
  // QUALUNQUE percorso non gestito (fallback per il refresh del browser): non
  // basta guardare pathname === '/'.
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req))

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/')) {
    return e.respondWith(cacheFirst(req))
  }

  // Tutto il resto (/web-api.js, /viewer, le icone…) non passa da qui: senza
  // respondWith il browser fa da sé, e si risparmia il giro nella CacheStorage
  // su ogni richiesta che tanto non era cacheabile.
})
