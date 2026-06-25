const { ipcMain, app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { DIRS } = require('../paths')

// In dev: yt-dlp/ffmpeg devono essere nel PATH o in ./bin
// In produzione: inclusi come extraResource
function binDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', '..', 'bin')
}

function ytdlpPath() {
  // Override usato dai test e2e (binario finto, niente rete)
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const bundled = path.join(binDir(), binName)
  return fs.existsSync(bundled) ? bundled : binName
}

// Argomenti comuni a tutte le chiamate yt-dlp
function baseArgs() {
  const args = []

  // ffmpeg: usa il binario bundled se disponibile
  const ffmpegBin = path.join(binDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  if (fs.existsSync(ffmpegBin)) {
    args.push('--ffmpeg-location', binDir())
  }

  // JS runtime: Node.js è disponibile come runtime nativo in Electron
  // (evita il warning "No supported JavaScript runtime" di yt-dlp)
  args.push('--js-runtimes', `node:${process.execPath}`)

  return args
}

function run(args, onLine) {
  return new Promise((resolve, reject) => {
    // ELECTRON_RUN_AS_NODE: process.execPath è il binario Electron, non Node.
    // Quando yt-dlp lo invoca come JS runtime (--js-runtimes) erediterebbe
    // l'avvio dell'app intera; con questa variabile si comporta da Node puro.
    const proc = spawn(ytdlpPath(), args, {
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => {
      const text = d.toString()
      out += text
      if (onLine) text.split(/\r?\n/).forEach((l) => l && onLine(l))
    })
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exit ${code}`))
    )
  })
}

function extractYoutubeId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)
  return m ? m[1] : null
}

// Espande un blocco di testo (URL/playlist separati da spazi, virgole o a
// capo) nella lista di video da scaricare. Le playlist (list=...) vengono
// risolte con --flat-playlist; i singoli video non toccano la rete qui.
async function expandUrls(text) {
  const tokens = String(text || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const out = []
  const seen = new Set()
  const push = (entry) => {
    if (entry.ytId) {
      if (seen.has(entry.ytId)) return
      seen.add(entry.ytId)
    }
    out.push(entry)
  }

  for (const tok of tokens) {
    if (/[?&]list=/.test(tok)) {
      const json = JSON.parse(await run([...baseArgs(), '--flat-playlist', '-J', tok]))
      for (const en of json.entries || []) {
        const id = en.id || null
        const url = en.url || (id ? `https://youtu.be/${id}` : tok)
        push({ url, ytId: id, title: en.title || id || url })
      }
    } else {
      push({ url: tok, ytId: extractYoutubeId(tok), title: tok })
    }
  }
  return out
}

async function downloadTrack(url, onProgress = () => {}) {
  const ytId = extractYoutubeId(url)
  if (!ytId) throw new Error('URL YouTube non valido')

  const base = baseArgs()

  // 1. Metadata
  onProgress({ phase: 'metadata', percent: null })
  const meta = JSON.parse(await run([...base, '-J', '--no-playlist', url]))

  // 2. Audio (mp3). --newline: progresso riga per riga invece di \r
  const audioName = `${ytId}.mp3`
  const audioOut = path.join(DIRS.downloaded, audioName)
  onProgress({ phase: 'audio', percent: 0 })
  await run([
    ...base,
    '-x', '--audio-format', 'mp3', '--no-playlist', '--newline',
    '-o', path.join(DIRS.downloaded, `${ytId}.%(ext)s`),
    url
  ], (line) => {
    const m = line.match(/^\[download\]\s+([\d.]+)%/)
    if (m) onProgress({ phase: 'audio', percent: Number(m[1]) })
    else if (line.startsWith('[ExtractAudio]')) onProgress({ phase: 'convert', percent: null })
  })

  // 3. Thumbnail
  onProgress({ phase: 'thumbnail', percent: null })
  let thumbnailPath = null
  try {
    await run([
      ...base,
      '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg',
      '-o', path.join(DIRS.thumbnails, ytId),
      url
    ])
    if (fs.existsSync(path.join(DIRS.thumbnails, `${ytId}.jpg`))) {
      thumbnailPath = `library/thumbnails/${ytId}.jpg`
    }
  } catch { /* thumbnail facoltativa */ }

  if (!fs.existsSync(audioOut)) throw new Error('Download audio fallito')

  // 4. Track entry
  return {
    id: `yt_${ytId}`,
    version: 1,
    title: meta.title || ytId,
    type: 'music',
    volume: 0.7,
    audioPath: `library/downloaded/${audioName}`,
    thumbnailPath,
    source: { type: 'youtube', youtubeId: ytId, url }
  }
}

module.exports = function registerYtdlpIpc() {
  // Espansione playlist / lista di URL (per il download in blocco)
  ipcMain.handle('ytdlp:expand', (_e, text) => expandUrls(text))

  // jobId: instrada gli eventi di progresso al job giusto nel renderer,
  // così più download possono procedere in parallelo
  ipcMain.handle('ytdlp:download', (e, { url, jobId } = {}) =>
    downloadTrack(url, (p) => e.sender.send('ytdlp:progress', { jobId, ...p }))
  )

  // Ri-download automatico per file mancanti (al caricamento board)
  ipcMain.handle('ytdlp:redownload', (e, { track, jobId } = {}) => {
    if (track?.source?.type !== 'youtube') throw new Error('Non è una traccia YouTube')
    return downloadTrack(track.source.url, (p) =>
      e.sender.send('ytdlp:progress', { jobId, ...p })
    )
  })
}
