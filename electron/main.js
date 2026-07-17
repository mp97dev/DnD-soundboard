const { app, BrowserWindow, Menu, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const { Readable } = require('stream')
const { DATA_DIR, ensureDataDirs } = require('./paths')
const registerFilesystemIpc = require('./ipc/filesystem')
const registerSettingsIpc = require('./ipc/settings')
const registerYtdlpIpc = require('./ipc/ytdlp')
const registerConfigIpc = require('./ipc/config')
const registerCastIpc = require('./ipc/cast')

// WSL: la GPU virtuale causa errori di rendering (popup dei select inclusi)
function isWSL() {
  try {
    return process.platform === 'linux' && fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft')
  } catch {
    return false
  }
}
if (isWSL()) app.disableHardwareAcceleration()

// Protocollo custom: media://<relative-path> -> file dentro DATA_DIR.
// Il renderer non tocca mai il filesystem direttamente.
// supportFetchAPI è obbligatorio perché l'audio engine usa fetch().
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
      // fetch() dal renderer (http in dev, file in prod) è cross-origin
      // verso media://: senza CORS la richiesta viene bloccata
      corsEnabled: true
    }
  }
])

function createWindow() {
  // Niente barra File/Edit/View: è una soundboard, non un editor di testo.
  // (Su macOS il menu applicazione resta, è la convenzione della piattaforma.)
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#14161c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ensureDataDirs()

  // Con standard:true l'URL media://library/downloaded/x.mp3 viene parsato
  // come host="library" + pathname="/downloaded/x.mp3": li ricomponiamo.
  //
  // Il handler serve i file direttamente da fs con supporto alle richieste
  // Range (206 Partial Content). Il media player di Chromium streama i file
  // lunghi a blocchi di byte range: senza Accept-Ranges/206 riceve ogni volta
  // il file intero da capo, il demuxer scarta e ri-chiede di continuo e
  // l'audio va in stutter (buffer caricato a frazioni di secondo).
  const { MIME: MIME_TYPES } = require('../server/lib/media')
  // Header CORS: corsEnabled da solo non basta, la risposta deve
  // autorizzare esplicitamente l'origin del renderer
  const mediaHeaders = (extra = {}) => ({ 'Access-Control-Allow-Origin': '*', ...extra })

  protocol.handle('media', async (request) => {
    const u = new URL(request.url)
    const rel = decodeURIComponent(u.host + u.pathname)
    // split('/') -> path.join: separatori corretti su Windows e Linux
    const resolved = path.normalize(path.join(DATA_DIR, ...rel.split('/')))
    // Impedisce path traversal fuori da DATA_DIR
    const outside = path.relative(path.normalize(DATA_DIR), resolved)
    if (outside.startsWith('..') || path.isAbsolute(outside)) {
      return new Response('Forbidden', { status: 403, headers: mediaHeaders() })
    }

    let stat
    try {
      stat = await fs.promises.stat(resolved)
    } catch {
      return new Response('Not found', { status: 404, headers: mediaHeaders() })
    }

    const size = stat.size
    const contentType = MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream'
    const range = request.headers.get('range')
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null

    if (m && (m[1] !== '' || m[2] !== '')) {
      let start, end
      if (m[1] === '') {
        // Suffix range: ultimi N byte (es. "bytes=-500")
        start = Math.max(0, size - Number(m[2]))
        end = size - 1
      } else {
        start = Number(m[1])
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
      }
      if (start >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: mediaHeaders({ 'Content-Range': `bytes */${size}` })
        })
      }
      const headers = mediaHeaders({
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`
      })
      if (request.method === 'HEAD') return new Response(null, { status: 206, headers })
      return new Response(Readable.toWeb(fs.createReadStream(resolved, { start, end })), {
        status: 206,
        headers
      })
    }

    const headers = mediaHeaders({
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size)
    })
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    return new Response(Readable.toWeb(fs.createReadStream(resolved)), { status: 200, headers })
  })

  registerFilesystemIpc()
  registerSettingsIpc()
  registerYtdlpIpc()
  registerConfigIpc()
  registerCastIpc()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
