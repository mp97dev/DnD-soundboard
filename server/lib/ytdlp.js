// Download YouTube lato server (Linux). Versione semplificata di
// electron/ipc/ytdlp.js: qui process.execPath è già Node, quindi niente
// workaround --js-runtimes / ELECTRON_RUN_AS_NODE.
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { DIRS, BIN_DIR } = require('./paths')

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

function run(args, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath(), args)
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

async function downloadTrack(url, onProgress = () => {}) {
  const ytId = extractYoutubeId(url)
  if (!ytId) throw new Error('URL YouTube non valido')

  const base = baseArgs()

  // 1. Metadata
  onProgress({ phase: 'metadata', percent: null })
  const meta = JSON.parse(await run([...base, '-J', '--no-playlist', url]))

  // 2. Audio (mp3). SOUNDBOARD_AUDIO_QUALITY: leva opzionale per ridurre la
  //    dimensione (es. 7 ≈ 96kbps) e quindi l'egress sui loop di ambience.
  const audioName = `${ytId}.mp3`
  const audioOut = path.join(DIRS.downloaded, audioName)
  const qualityArgs = process.env.SOUNDBOARD_AUDIO_QUALITY
    ? ['--audio-quality', process.env.SOUNDBOARD_AUDIO_QUALITY]
    : []
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
    }
  )

  // 3. Thumbnail (facoltativa)
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

module.exports = { expandUrls, downloadTrack, extractYoutubeId }
