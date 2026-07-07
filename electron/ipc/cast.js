// Chromecast dal desktop. Il renderer sceglie il dispositivo e il visual;
// qui il main process ordina al Chromecast di scaricare il media da un
// mini-server HTTP locale (solo /media/*, bind su 0.0.0.0) che avviamo
// apposta: il protocollo media:// non è raggiungibile dalla TV.
const { ipcMain } = require('electron')
const http = require('http')
const cast = require('../../server/lib/cast')
const { serveMedia, contentTypeFor } = require('../../server/lib/media')
const { DATA_DIR } = require('../paths')

const CAST_PORT = Number(process.env.SOUNDBOARD_CAST_PORT) || 8123

let mediaServer = null
let mediaPort = null

function ensureMediaServer() {
  if (mediaServer) return Promise.resolve(mediaPort)
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      // niente decode qui: ci pensa serveMedia (decodeURIComponent)
      const m = /^\/media\/(.+)/.exec(req.url.split('?')[0])
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
    const url = `http://${ip}:${port}/media/${mediaPath.split('/').map(encodeURIComponent).join('/')}`
    return cast.show({ host, url, contentType: contentTypeFor(mediaPath), title })
  })
}
