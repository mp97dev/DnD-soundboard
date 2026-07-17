const { ipcMain, app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { DIRS } = require('../paths')
const { preferredBin, maybeUpdate, friendlyError } = require('../../server/lib/ytdlp-update')

// In dev: yt-dlp/ffmpeg devono essere nel PATH o in ./bin
// In produzione: inclusi come extraResource
function binDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', '..', 'bin')
}

// Le resources del pacchetto non sono scrivibili: le copie auto-aggiornate
// di yt-dlp vivono in userData
function updateDir() {
  return path.join(app.getPath('userData'), 'bin')
}

function ytdlpPath() {
  // Override usato dai test e2e (binario finto, niente rete)
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const bundled = path.join(binDir(), binName)
  const base = fs.existsSync(bundled) ? bundled : binName
  return preferredBin(base, updateDir())
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

function runEnv() {
  // ELECTRON_RUN_AS_NODE: process.execPath è il binario Electron, non Node.
  // Quando yt-dlp lo invoca come JS runtime (--js-runtimes) erediterebbe
  // l'avvio dell'app intera; con questa variabile si comporta da Node puro.
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
}

// ---- Cancellazione ----
// jobId -> { cancelled, proc }: permette di interrompere un download in corso
// (playlist intere accodate per sbaglio) uccidendo il processo yt-dlp attivo.
const jobs = new Map()
const CANCELLED = 'Download annullato'

function trackJob(jobId) {
  if (!jobId) return null
  const job = { cancelled: false, proc: null }
  jobs.set(jobId, job)
  return job
}

function cancelJob(jobId) {
  const job = jobs.get(jobId)
  if (!job) return false
  job.cancelled = true
  try { job.proc?.kill() } catch { /* già terminato */ }
  return true
}

function checkCancelled(job) {
  if (job?.cancelled) throw new Error(CANCELLED)
}

function rawRun(args, onLine, job) {
  return new Promise((resolve, reject) => {
    if (job?.cancelled) return reject(new Error(CANCELLED))
    const proc = spawn(ytdlpPath(), args, { windowsHide: true, env: runEnv() })
    // Priorità bassa: yt-dlp+ffmpeg a piena CPU fanno stutterare l'audio
    // e rallentano la UI durante i download
    try { require('os').setPriority(proc.pid, 10) } catch { /* non critico */ }
    if (job) job.proc = proc
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => {
      const text = d.toString()
      out += text
      if (onLine) text.split(/\r?\n/).forEach((l) => l && onLine(l))
    })
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (job) job.proc = null
      if (job?.cancelled) return reject(new Error(CANCELLED))
      code === 0 ? resolve(out) : reject(new Error(err || `yt-dlp exit ${code}`))
    })
  })
}

// Se un comando fallisce spesso è perché YouTube ha cambiato qualcosa e il
// binario bundled è stantio: prova `yt-dlp -U` e ritenta una volta.
async function run(args, onLine, job) {
  try {
    return await rawRun(args, onLine, job)
  } catch (err) {
    if (job?.cancelled) throw err
    // Con YTDLP_PATH (test) il binario è fissato dall'esterno: niente update
    if (process.env.YTDLP_PATH) throw friendlyError(err)
    let updated = null
    try {
      updated = await maybeUpdate({
        current: ytdlpPath(),
        writableDir: updateDir(),
        env: runEnv()
      })
    } catch { /* update fallito: riporta l'errore originale */ }
    if (!updated) throw friendlyError(err)
    try {
      return await rawRun(args, onLine, job)
    } catch (err2) {
      throw friendlyError(err2)
    }
  }
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

async function downloadTrack(url, onProgress = () => {}, jobId = null) {
  const ytId = extractYoutubeId(url)
  if (!ytId) throw new Error('URL YouTube non valido')

  const base = baseArgs()
  const job = trackJob(jobId)
  try {
    return await doDownloadTrack({ url, ytId, base, onProgress, job })
  } finally {
    if (jobId) jobs.delete(jobId)
  }
}

async function doDownloadTrack({ url, ytId, base, onProgress, job }) {
  // 1. Metadata
  onProgress({ phase: 'metadata', percent: null })
  const meta = JSON.parse(await run([...base, '-J', '--no-playlist', url], null, job))

  // 2. Audio (mp3). --newline: progresso riga per riga invece di \r
  const audioName = `${ytId}.mp3`
  const audioOut = path.join(DIRS.downloaded, audioName)
  checkCancelled(job)
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
  }, job)

  // 3. Thumbnail
  checkCancelled(job)
  onProgress({ phase: 'thumbnail', percent: null })
  let thumbnailPath = null
  try {
    await run([
      ...base,
      '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg',
      '-o', path.join(DIRS.thumbnails, ytId),
      url
    ], null, job)
    if (fs.existsSync(path.join(DIRS.thumbnails, `${ytId}.jpg`))) {
      thumbnailPath = `library/thumbnails/${ytId}.jpg`
    }
  } catch (e) {
    checkCancelled(job)
    /* thumbnail facoltativa */
  }

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

// Scarica il VIDEO (per il casting su Chromecast): mp4 con H.264 + AAC,
// il profilo compatibile con tutti i modelli di Chromecast, max 1080p.
async function downloadVisual(url, onProgress = () => {}, jobId = null) {
  const ytId = extractYoutubeId(url)
  if (!ytId) throw new Error('URL YouTube non valido')

  const base = baseArgs()
  const job = trackJob(jobId)
  try {
    return await doDownloadVisual({ url, ytId, base, onProgress, job })
  } finally {
    if (jobId) jobs.delete(jobId)
  }
}

async function doDownloadVisual({ url, ytId, base, onProgress, job }) {
  onProgress({ phase: 'metadata', percent: null })
  const meta = JSON.parse(await run([...base, '-J', '--no-playlist', url], null, job))

  const videoName = `${ytId}.mp4`
  const videoOut = path.join(DIRS.downloaded, videoName)
  checkCancelled(job)
  onProgress({ phase: 'video', percent: 0 })
  await run(
    [
      ...base,
      '-f', 'bestvideo[ext=mp4][vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best[height<=1080]',
      '--merge-output-format', 'mp4',
      '--no-playlist', '--newline',
      '-o', videoOut,
      url
    ],
    (line) => {
      const m = line.match(/^\[download\]\s+([\d.]+)%/)
      if (m) onProgress({ phase: 'video', percent: Number(m[1]) })
      else if (line.startsWith('[Merger]')) onProgress({ phase: 'convert', percent: null })
    },
    job
  )

  checkCancelled(job)
  onProgress({ phase: 'thumbnail', percent: null })
  let thumbnailPath = null
  try {
    await run([
      ...base,
      '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg',
      '-o', path.join(DIRS.thumbnails, ytId),
      url
    ], null, job)
    if (fs.existsSync(path.join(DIRS.thumbnails, `${ytId}.jpg`))) {
      thumbnailPath = `library/thumbnails/${ytId}.jpg`
    }
  } catch (e) {
    checkCancelled(job)
    /* thumbnail facoltativa */
  }

  if (!fs.existsSync(videoOut)) throw new Error('Download video fallito')

  return {
    id: `ytv_${ytId}`,
    version: 1,
    title: meta.title || ytId,
    type: 'visual',
    volume: 1,
    mediaPath: `library/downloaded/${videoName}`,
    thumbnailPath,
    source: { type: 'youtube', youtubeId: ytId, url }
  }
}

// yt-dlp con --newline emette decine di righe al secondo: senza throttle
// ogni riga diventa un IPC + re-render del renderer (UI molle durante i
// download). Inoltra solo i cambi di fase o di punto percentuale intero.
function throttleProgress(send) {
  let lastPhase
  let lastPct
  return (p) => {
    const pct = p.percent == null ? null : Math.floor(p.percent)
    if (p.phase === lastPhase && pct === lastPct) return
    lastPhase = p.phase
    lastPct = pct
    send(p)
  }
}

module.exports = function registerYtdlpIpc() {
  // Espansione playlist / lista di URL (per il download in blocco)
  ipcMain.handle('ytdlp:expand', (_e, text) => expandUrls(text))

  // jobId: instrada gli eventi di progresso al job giusto nel renderer,
  // così più download possono procedere in parallelo
  ipcMain.handle('ytdlp:download', (e, { url, jobId } = {}) =>
    downloadTrack(url, throttleProgress((p) => e.sender.send('ytdlp:progress', { jobId, ...p })), jobId)
  )

  // Download del video mp4 (visual per il casting)
  ipcMain.handle('ytdlp:downloadVisual', (e, { url, jobId } = {}) =>
    downloadVisual(url, throttleProgress((p) => e.sender.send('ytdlp:progress', { jobId, ...p })), jobId)
  )

  // Ri-download automatico per file mancanti (al caricamento board)
  ipcMain.handle('ytdlp:redownload', (e, { track, jobId } = {}) => {
    if (track?.source?.type !== 'youtube') throw new Error('Non è una traccia YouTube')
    const dl = track.type === 'visual' ? downloadVisual : downloadTrack
    return dl(track.source.url, throttleProgress((p) =>
      e.sender.send('ytdlp:progress', { jobId, ...p })), jobId)
  })

  // Interrompe il download in corso di un job (uccide il processo yt-dlp)
  ipcMain.handle('ytdlp:cancel', (_e, jobId) => cancelJob(jobId))
}
