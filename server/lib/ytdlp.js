// Download YouTube lato server (Linux). Versione semplificata di
// electron/ipc/ytdlp.js: qui process.execPath è già Node, quindi niente
// workaround --js-runtimes / ELECTRON_RUN_AS_NODE.
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { DIRS, BIN_DIR } = require('./paths')
const { maybeUpdate, friendlyError } = require('./ytdlp-update')

// Cerca prima in ./bin (npm run fetch:ytdlp), poi nel PATH di sistema (apt)
function binPath(name) {
  const local = path.join(BIN_DIR, name)
  return fs.existsSync(local) ? local : name
}

function ytdlpPath() {
  // YTDLP_PATH: override per i test (binario finto, niente rete)
  return process.env.YTDLP_PATH || binPath('yt-dlp')
}

function baseArgs() {
  const args = []
  // ffmpeg bundled in ./bin se presente, altrimenti yt-dlp usa quello di sistema
  const ffmpeg = path.join(BIN_DIR, 'ffmpeg')
  if (fs.existsSync(ffmpeg)) args.push('--ffmpeg-location', BIN_DIR)
  return args
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

function cancel(jobId) {
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
    const proc = spawn(ytdlpPath(), args)
    // Priorità bassa: yt-dlp+ffmpeg a piena CPU rallentano tutto il resto
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
// binario in ./bin è stantio: prova `yt-dlp -U` e ritenta una volta.
// (./bin è scrivibile perché è dove fetch:ytdlp scarica il binario.)
async function run(args, onLine, job) {
  try {
    return await rawRun(args, onLine, job)
  } catch (err) {
    if (job?.cancelled) throw err
    // Con YTDLP_PATH (test) il binario è fissato dall'esterno: niente update
    if (process.env.YTDLP_PATH) throw friendlyError(err)
    let updated = null
    try {
      updated = await maybeUpdate({ current: ytdlpPath(), writableDir: BIN_DIR })
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

// Espande testo (URL/playlist separati da spazi, virgole o a capo) nella lista
// dei video da scaricare. Le playlist (list=...) sono risolte con --flat-playlist.
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

  // 2. Audio (mp3). SOUNDBOARD_AUDIO_QUALITY: leva opzionale per ridurre la
  //    dimensione (es. 7 ≈ 96kbps) e quindi l'egress sui loop di ambience.
  const audioName = `${ytId}.mp3`
  const audioOut = path.join(DIRS.downloaded, audioName)
  const qualityArgs = process.env.SOUNDBOARD_AUDIO_QUALITY
    ? ['--audio-quality', process.env.SOUNDBOARD_AUDIO_QUALITY]
    : []
  checkCancelled(job)
  onProgress({ phase: 'audio', percent: 0 })
  await run(
    [
      ...base,
      '-x', '--audio-format', 'mp3', ...qualityArgs, '--no-playlist', '--newline',
      '-o', path.join(DIRS.downloaded, `${ytId}.%(ext)s`),
      url
    ],
    (line) => {
      const m = line.match(/^\[download\]\s+([\d.]+)%/)
      if (m) onProgress({ phase: 'audio', percent: Number(m[1]) })
      else if (line.startsWith('[ExtractAudio]')) onProgress({ phase: 'convert', percent: null })
    },
    job
  )

  // 3. Thumbnail (facoltativa)
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

module.exports = { expandUrls, downloadTrack, downloadVisual, extractYoutubeId, cancel }
