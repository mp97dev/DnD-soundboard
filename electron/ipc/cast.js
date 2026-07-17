// Chromecast dal desktop. Il renderer sceglie il dispositivo e il visual;
// qui il main process ordina al Chromecast di scaricare il media da un
// mini-server HTTP locale (solo /media/*, bind su 0.0.0.0) che avviamo
// apposta: il protocollo media:// non è raggiungibile dalla TV.
const { ipcMain, app } = require('electron')
const http = require('http')
const path = require('path')
const fs = require('fs')
const cast = require('../../server/lib/cast')
const { serveMedia, contentTypeFor, BLANK_PNG } = require('../../server/lib/media')
const { ensureLoopPlaylist } = require('../../server/lib/hlsloop')
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

module.exports = function registerCastIpc() {
  ipcMain.handle('cast:devices', () => cast.listDevices())
  ipcMain.handle('cast:status', () => cast.status())
  ipcMain.handle('cast:stop', () => cast.stop())

  ipcMain.handle('cast:show', async (_e, { host, path: mediaPath, title } = {}) => {
    const port = await ensureMediaServer()
    const ip = cast.lanIp()
    if (!ip) throw new Error('Impossibile determinare l\'IP LAN di questo PC')

    // Video → HLS con playlist che ripete i segmenti: loop senza overlay né
    // reload sul receiver. Se la segmentazione non riesce, mp4 diretto.
    let rel = mediaPath
    let contentType = contentTypeFor(mediaPath)
    if (contentType.startsWith('video/')) {
      const hls = await ensureLoopPlaylist({
        dataDir: DATA_DIR, mediaRel: mediaPath, ffmpegPath: ffmpegPath()
      })
      if (hls) {
        rel = hls
        contentType = 'application/vnd.apple.mpegurl'
      }
    }
    const url = `http://${ip}:${port}/media/${rel.split('/').map(encodeURIComponent).join('/')}`
    return cast.show({ host, url, contentType, title })
  })

  // Schermo nero senza staccare la sessione ("Ferma tutto")
  ipcMain.handle('cast:blank', async () => {
    const port = await ensureMediaServer()
    const ip = cast.lanIp()
    if (!ip) throw new Error('Impossibile determinare l\'IP LAN di questo PC')
    return cast.blank({ url: `http://${ip}:${port}/blank.png` })
  })
}
