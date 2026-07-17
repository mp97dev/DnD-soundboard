// Serving dei file media con supporto Range (206 Partial Content).
// Condiviso tra il server LAN (Express) e il mini-server HTTP che il main
// process Electron avvia per il casting: usa solo l'API http.ServerResponse
// standard, nessuna dipendenza da Express.
const fs = require('fs')
const path = require('path')

const MIME = {
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  // HLS (loop dei visual sul Chromecast)
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t'
}

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

// rel: percorso relativo dentro dataDir, con separatori '/'
function serveMedia(req, res, rel, dataDir) {
  rel = decodeURIComponent(rel)
  const resolved = path.normalize(path.join(dataDir, ...rel.split('/')))
  // Niente path traversal fuori da dataDir
  const outside = path.relative(path.normalize(dataDir), resolved)
  if (outside.startsWith('..') || path.isAbsolute(outside)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }

  let stat
  try {
    stat = fs.statSync(resolved)
  } catch {
    res.writeHead(404)
    return res.end('Not found')
  }

  const size = stat.size
  const baseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Content-Type': contentTypeFor(resolved),
    // I file media sono content-addressed (ytId) e non cambiano mai: immutable
    // → il client li riusa dalla cache senza ri-scaricarli (egress ~ 1x/device).
    'Cache-Control': 'public, max-age=31536000, immutable'
  }

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
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${size}` })
      return res.end()
    }
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1
    })
    if (req.method === 'HEAD') return res.end()
    return fs.createReadStream(resolved, { start, end }).pipe(res)
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': size })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(resolved).pipe(res)
}

// PNG 1280x720 tutto nero (973 byte): lo "schermo vuoto" mostrato in TV da
// "Ferma tutto" al posto della disconnessione. Generato una volta e embeddato
// per non dipendere da file su disco.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAAAAADqFoKKAAADlElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/BsTogAB8AknUQAAAABJRU5ErkJggg==',
  'base64'
)

module.exports = { serveMedia, contentTypeFor, MIME, BLANK_PNG }
