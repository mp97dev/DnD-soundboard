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
const cast = require('./lib/cast')
const { serveMedia, contentTypeFor } = require('./lib/media')
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
app.post('/api/library/import', express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
  const name = decodeURIComponent(req.get('X-Filename') || 'audio.mp3')
  const kind = req.query.kind === 'visual' ? 'visual' : 'audio'
  res.json(store.importLocalFile(req.body, name, kind))
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
app.post('/api/ytdlp/download-visual', async (req, res) => {
  const { url, jobId } = req.body || {}
  try {
    const track = await ytdlp.downloadVisual(url, (p) => broadcast({ type: 'progress', jobId, ...p }))
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
    const dl = track.type === 'visual' ? ytdlp.downloadVisual : ytdlp.downloadTrack
    const t = await dl(track.source.url, (p) =>
      broadcast({ type: 'progress', jobId, ...p })
    )
    res.json(t)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ---------- Chromecast ----------
// Il cast parte da QUI (Node), non dal browser: il server ordina al
// Chromecast di scaricare il media dal proprio endpoint /media/.
app.get('/api/cast/devices', (_req, res) => res.json(cast.listDevices()))
app.get('/api/cast/status', (_req, res) => res.json(cast.status()))
app.post('/api/cast/stop', async (_req, res) => res.json(await cast.stop()))
app.post('/api/cast/show', async (req, res) => {
  const { host, path: mediaPath, title } = req.body || {}
  try {
    // URL raggiungibile dalla TV: l'host con cui il client ha raggiunto il
    // server (se non è localhost), altrimenti l'IP LAN rilevato.
    const reqHost = String(req.headers.host || '').split(':')[0]
    const usable = reqHost && !['localhost', '127.0.0.1'].includes(reqHost) ? reqHost : cast.lanIp()
    if (!usable) throw new Error('Impossibile determinare l\'IP LAN del server')
    const url = `http://${usable}:${PORT}/media/${mediaPath.split('/').map(encodeURIComponent).join('/')}`
    res.json(await cast.show({ host, url, contentType: contentTypeFor(mediaPath), title }))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ---------- Media (con supporto Range) ----------
app.get(/^\/media\/(.+)/, (req, res) => serveMedia(req, res, req.params[0], DATA_DIR))
app.head(/^\/media\/(.+)/, (req, res) => serveMedia(req, res, req.params[0], DATA_DIR))

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
