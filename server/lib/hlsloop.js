// Loop "senza cuciture" dei video sul Chromecast via HLS.
//
// Il Default Media Receiver mostra overlay (titolo, barra) e ri-bufferizza a
// OGNI ripetizione, sia col repeatMode della coda sia col reload manuale:
// l'unico modo per un loop pulito senza receiver custom è dargli UN SOLO
// media lunghissimo. Invece di moltiplicare il file (disco ×N), il video
// viene segmentato una volta con ffmpeg (-c copy, veloce) e una playlist HLS
// VOD ripete gli stessi segmenti per ~4 ore: al receiver sembra un unico
// filmato, i passaggi tra segmenti non mostrano alcuna UI.
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const TARGET_TOTAL_SECONDS = 4 * 60 * 60 // durata fittizia della playlist
const MAX_LOOPS = 500

// Segmenta il video (se non già fatto) e genera la playlist loop.m3u8.
// Ritorna il path relativo a dataDir della playlist, o null se ffmpeg non è
// disponibile / la segmentazione fallisce (il chiamante usa il mp4 diretto).
async function ensureLoopPlaylist({ dataDir, mediaRel, ffmpegPath }) {
  try {
    const abs = path.join(dataDir, ...mediaRel.split('/'))
    if (!fs.existsSync(abs)) return null

    const name = path.basename(mediaRel).replace(/\.[^.]+$/, '')
    const hlsRel = `library/hls/${name}`
    const hlsDir = path.join(dataDir, 'library', 'hls', name)
    const loopFile = path.join(hlsDir, 'loop.m3u8')

    // Cache: segmentazione già fatta (e più recente del sorgente)
    if (fs.existsSync(loopFile) &&
        fs.statSync(loopFile).mtimeMs >= fs.statSync(abs).mtimeMs) {
      return `${hlsRel}/loop.m3u8`
    }

    fs.mkdirSync(hlsDir, { recursive: true })
    await segment(ffmpegPath, abs, hlsDir)
    writeLoopPlaylist(hlsDir, loopFile)
    return `${hlsRel}/loop.m3u8`
  } catch {
    return null
  }
}

function segment(ffmpegPath, input, outDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-y', '-i', input,
      '-c', 'copy',
      '-f', 'hls',
      '-hls_time', '10',
      '-hls_list_size', '0',
      '-hls_segment_filename', path.join(outDir, 'seg_%04d.ts'),
      path.join(outDir, 'index.m3u8')
    ])
    try { require('os').setPriority(proc.pid, 10) } catch { /* non critico */ }
    let err = ''
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg exit ${code}`))
    )
  })
}

// Da index.m3u8 (una passata del video) genera loop.m3u8 (N passate).
// EXT-X-DISCONTINUITY a ogni giro: i timestamp dei segmenti ripartono da 0.
function writeLoopPlaylist(hlsDir, loopFile) {
  const src = fs.readFileSync(path.join(hlsDir, 'index.m3u8'), 'utf-8')
  const lines = src.split(/\r?\n/)

  let targetDuration = 11
  const segs = [] // [{ extinf, uri }]
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (l.startsWith('#EXT-X-TARGETDURATION:')) targetDuration = Number(l.split(':')[1]) || 11
    if (l.startsWith('#EXTINF:')) {
      const uri = (lines[i + 1] || '').trim()
      if (uri && !uri.startsWith('#')) segs.push({ extinf: l, uri })
    }
  }
  if (!segs.length) throw new Error('index.m3u8 senza segmenti')

  const loopSeconds = segs.reduce(
    (sum, s) => sum + (parseFloat(s.extinf.slice('#EXTINF:'.length)) || 10), 0
  )
  const loops = Math.max(1, Math.min(MAX_LOOPS, Math.ceil(TARGET_TOTAL_SECONDS / loopSeconds)))

  const out = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD'
  ]
  for (let i = 0; i < loops; i++) {
    if (i > 0) out.push('#EXT-X-DISCONTINUITY')
    for (const s of segs) out.push(s.extinf, s.uri)
  }
  out.push('#EXT-X-ENDLIST', '')
  fs.writeFileSync(loopFile, out.join('\n'), 'utf-8')
}

module.exports = { ensureLoopPlaylist }
