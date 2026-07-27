// Chromecast dal desktop. Il renderer sceglie il dispositivo e il visual;
// qui il main process ordina al Chromecast di scaricare il media da un
// mini-server HTTP locale (solo /media/*, bind su 0.0.0.0) che avviamo
// apposta: il protocollo media:// non è raggiungibile dalla TV.
const { ipcMain, app } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')
const cast = require('../../server/lib/cast')
const viewer = require('../../server/lib/viewer')
const visuals = require('../../server/lib/visuals')
const { serveMedia, BLANK_PNG } = require('../../server/lib/media')
const { DATA_DIR } = require('../paths')

const CAST_PORT = Number(process.env.SOUNDBOARD_CAST_PORT) || 8123

// ffmpeg: bundled (extraResource / ./bin in dev) o nel PATH di sistema
function ffmpegPath() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', '..', 'bin')
  const bin = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  return fs.existsSync(bin) ? bin : 'ffmpeg'
}

let mediaServer = null
let mediaPort = null

function ensureMediaServer() {
  if (mediaServer) return Promise.resolve(mediaPort)
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = req.url.split('?')[0]
      // Preflight CORS: il receiver Chromecast carica gli HLS via XHR e può
      // mandare OPTIONS (header Range non safelisted)
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD',
          'Access-Control-Allow-Headers': 'Range, Content-Type'
        })
        return res.end()
      }
      if (url === '/blank.png' && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': BLANK_PNG.length })
        return req.method === 'HEAD' ? res.end() : res.end(BLANK_PNG)
      }
      if (url === '/viewer' && req.method === 'GET') {
        // A differenza di Express, questo handler gira nudo dentro
        // http.createServer: un throw qui (viewer.html assente dal pacchetto,
        // permessi) diventa un'eccezione non gestita che ABBATTE il main
        // process. Il viewer è un extra: se non si può servire, 500 e via.
        let html
        try {
          html = viewer.viewerHtml()
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          return res.end(`Viewer non disponibile: ${err.message}`)
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end(html)
      }
      if (url === '/api/cast/current' && req.method === 'GET') {
        const cur = visuals.currentForViewer()
        // Il tablet ripassa di qui in continuazione: con un ETag la risposta
        // invariata (il caso normale) è un 304 senza corpo. ts cambia ad ogni
        // visual mostrato, quindi basta lui a identificare lo stato.
        // Express fa lo stesso da solo sull'altro host.
        const etag = `W/"${cur ? cur.ts : 'none'}"`
        const headers = { ETag: etag, 'Access-Control-Allow-Origin': '*' }
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, headers)
          return res.end()
        }
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(cur))
      }
      // niente decode qui: ci pensa serveMedia (decodeURIComponent)
      const m = /^\/media\/(.+)/.exec(url)
      if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404)
        return res.end('Not found')
      }
      serveMedia(req, res, m[1], DATA_DIR)
    })
    srv.on('error', (err) => {
      mediaServer = null
      reject(new Error(`Media server per il cast non avviabile (porta ${CAST_PORT}): ${err.message}`))
    })
    srv.listen(CAST_PORT, '0.0.0.0', () => {
      mediaServer = srv
      mediaPort = CAST_PORT
      resolve(mediaPort)
    })
  })
}

// URL con cui TV e tablet raggiungono il mini-server di questo PC. Avvia il
// server se non gira ancora: il viewer deve essere servito anche quando non
// c'è nessuna TV in gioco.
async function lanBaseUrl() {
  const port = await ensureMediaServer()
  const ip = cast.lanIp()
  if (!ip) throw new Error('Impossibile determinare l\'IP LAN di questo PC')
  return `http://${ip}:${port}`
}

module.exports = function registerCastIpc() {
  ipcMain.handle('cast:devices', () => cast.listDevices())
  ipcMain.handle('cast:status', () => visuals.status())
  ipcMain.handle('cast:stop', () => visuals.stop())

  ipcMain.handle('cast:show', async (_e, { host, path: mediaPath, title, visualId } = {}) => {
    // Il viewer va servito comunque, anche senza TV selezionata; l'IP LAN
    // invece serve solo alla TV, quindi in solo-viewer non deve essere un
    // requisito (né un errore se manca).
    await ensureMediaServer()
    return visuals.show({
      host,
      mediaPath,
      title,
      visualId,
      urlBase: host ? await lanBaseUrl() : null,
      dataDir: DATA_DIR,
      ffmpegPath: ffmpegPath()
    })
  })

  // Schermo nero senza staccare la sessione ("Ferma tutto")
  ipcMain.handle('cast:blank', async () => visuals.blank({ urlBase: await lanBaseUrl() }))

  ipcMain.handle('cast:viewerUrl', async () => visuals.viewerUrl(await lanBaseUrl()))
}
