// Server LAN del soundboard.
// Espone le stesse operazioni del main process Electron via HTTP + WebSocket,
// così il renderer (Vue) gira nel browser di un tablet e riproduce l'audio
// localmente (output verso lo speaker Bluetooth del tablet). I download YouTube
// avvengono qui (dove yt-dlp/ffmpeg funzionano), il tablet li pilota soltanto.
const express = require('express')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { WebSocketServer } = require('ws')

const store = require('./lib/store')
const ytdlp = require('./lib/ytdlp')
const { DATA_DIR, RENDERER_DIR, ensureDataDirs } = require('./lib/paths')

const PORT = Number(process.env.PORT) || 8080
const HOST = process.env.HOST || '0.0.0.0'

ensureDataDirs()

const app = express()
app.use(express.json({ limit: '25mb' }))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
function broadcast(msg) {
  const data = JSON.stringify(msg)
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(data)
  })
}

// ---------- API ----------
app.get('/api/boards', (_req, res) => res.json(store.listBoards()))
app.post('/api/boards', (req, res) => res.json(store.saveBoard(req.body)))
app.delete('/api/boards/:id', (req, res) => res.json(store.deleteBoard(req.params.id)))

app.get('/api/library', (_req, res) => res.json(store.listLibrary()))
app.post('/api/library', (req, res) => res.json(store.saveLibrary(req.body)))
app.post('/api/library/import', express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const name = decodeURIComponent(req.get('X-Filename') || 'audio.mp3')
  res.json(store.importLocalFile(req.body, name))
})

app.get('/api/settings', (_req, res) => res.json(store.getSettings()))
app.post('/api/settings', (req, res) => res.json(store.saveSettings(req.body)))

app.get('/api/config/export', (_req, res) => {
  const name = `soundboard-export-${new Date().toISOString().slice(0, 10)}.json`
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.json(store.exportBundle())
})
app.post('/api/config/import', (req, res) => {
  try {
    res.json(store.importBundle(req.body))
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/ytdlp/expand', async (req, res) => {
  try {
    res.json(await ytdlp.expandUrls(req.body.text))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})
app.post('/api/ytdlp/download', async (req, res) => {
  const { url, jobId } = req.body || {}
  try {
    const track = await ytdlp.downloadTrack(url, (p) => broadcast({ type: 'progress', jobId, ...p }))
    res.json(track)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})
app.post('/api/ytdlp/redownload', async (req, res) => {
  const { track, jobId } = req.body || {}
  if (track?.source?.type !== 'youtube') {
    return res.status(400).json({ error: 'Non è una traccia YouTube' })
  }
  try {
    const t = await ytdlp.downloadTrack(track.source.url, (p) =>
      broadcast({ type: 'progress', jobId, ...p })
    )
    res.json(t)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ---------- Media (con supporto Range) ----------
const MIME = {
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'
}

function serveMedia(req, res, rel) {
  rel = decodeURIComponent(rel)
  const resolved = path.normalize(path.join(DATA_DIR, ...rel.split('/')))
  // Niente path traversal fuori da DATA_DIR
  const outside = path.relative(path.normalize(DATA_DIR), resolved)
  if (outside.startsWith('..') || path.isAbsolute(outside)) return res.status(403).end('Forbidden')

  let stat
  try {
    stat = fs.statSync(resolved)
  } catch {
    return res.status(404).end('Not found')
  }

  const size = stat.size
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream')
  // I file media sono content-addressed (ytId) e non cambiano mai: immutable
  // → il browser li riusa dalla cache senza ri-scaricarli (egress ~ 1x/device).
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

  const range = req.headers.range
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start, end
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]))
      end = size - 1
    } else {
      start = Number(m[1])
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
    }
    if (start >= size || start > end) {
      res.setHeader('Content-Range', `bytes */${size}`)
      return res.status(416).end()
    }
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    if (req.method === 'HEAD') return res.end()
    return fs.createReadStream(resolved, { start, end }).pipe(res)
  }

  res.status(200)
  res.setHeader('Content-Length', size)
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(resolved).pipe(res)
}
app.get(/^\/media\/(.+)/, (req, res) => serveMedia(req, res, req.params[0]))
app.head(/^\/media\/(.+)/, (req, res) => serveMedia(req, res, req.params[0]))

// ---------- Shell + asset statici ----------
// index.html della build, con iniettati il media base e il web shim PRIMA del
// bundle (il modulo dell'app è deferred, lo script classico gira prima).
function serveShell(res) {
  let html
  try {
    html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf-8')
  } catch {
    return res
      .status(503)
      .send('Renderer non ancora compilato. Esegui: npm run build:renderer')
  }
  const inject =
    `<script>window.__MEDIA_BASE__='/media/'</script>` +
    `<script src="/web-api.js"></script>`
  res.type('html').send(html.replace('</head>', `${inject}</head>`))
}

app.get('/web-api.js', (_req, res) => {
  res.type('application/javascript')
  res.sendFile(path.join(__dirname, 'web-api.js'))
})
app.get('/sw.js', (_req, res) => {
  res.type('application/javascript')
  res.setHeader('Service-Worker-Allowed', '/')
  res.sendFile(path.join(__dirname, 'sw.js'))
})

app.get(['/', '/index.html'], (_req, res) => serveShell(res))
app.use(express.static(RENDERER_DIR, { index: false }))
// Fallback: qualunque GET non gestito serve la shell (refresh del browser)
app.get(/.*/, (_req, res) => serveShell(res))

server.listen(PORT, HOST, () => {
  console.log(`DnD Soundboard server su http://${HOST}:${PORT}  (dati: ${DATA_DIR})`)
})
