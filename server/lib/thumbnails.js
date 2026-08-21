// Rimpicciolimento delle copertine.
//
// yt-dlp scarica la copertina di YouTube alla risoluzione che trova, cioè
// 1280x720. Quelle copertine non si guardano mai a quella misura: finiscono
// come sfondo di un bottone (misurato: 225x78, e al 25% di opacità) e come
// pallino nella libreria, dove il cursore dello zoom parte da 28x28.
//
// Il costo non è il file su disco — sono 50 KB — ma la BITMAP decodificata,
// che sta in memoria a 4 byte per pixel a prescindere da quanto è compresso il
// jpeg: 1280*720*4 = 3,7 MB l'una. Misurate sulla libreria di prova, sette
// copertine = 24,6 MB di bitmap per disegnare sette francobolli. Su un portatile
// del 2012 con la grafica integrata che si mangia la RAM di sistema, e un
// browser con dieci schede aperte accanto, è memoria che manca a qualcos'altro.
//
// A 480px di larghezza la stessa bitmap costa 480*270*4 = 518 KB: sette volte
// meno, e resta comunque più grande del bottone più largo che una griglia 12x8
// produce su uno schermo 1080p.
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const TARGET_WIDTH = 480
const PROBE_BYTES = 64 * 1024 // gli header SOF stanno all'inizio del file

// Larghezza e altezza di un JPEG, letti dagli header. Niente dipendenze e
// niente sottoprocesso: ffprobe non è nel pacchetto su tutte le piattaforme, e
// spawnare un processo per ogni copertina all'avvio costerebbe più del lavoro.
// Torna null su qualunque cosa non sia un JPEG leggibile — che è il segnale di
// "non toccarla", non un errore.
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue }
    const marker = buf[i + 1]
    // SOF0/1/2/3 e SOF9/10/11: i soli che portano le dimensioni. SOF4 (0xC4) e
    // SOF8 (0xC8) NON sono start-of-frame (sono tabelle Huffman e JPG esteso).
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc9 && marker <= 0xcb)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
    const len = buf.readUInt16BE(i + 2)
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

function readHeader(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(PROBE_BYTES)
    const read = fs.readSync(fd, buf, 0, PROBE_BYTES, 0)
    return buf.subarray(0, read)
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch { /* già chiuso */ }
  }
}

function runFfmpeg(ffmpegPath, args) {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'ignore'] })
    } catch {
      return resolve(false)
    }
    // Priorità bassa, come la segmentazione HLS: rimpicciolire le copertine non
    // deve mai rubare CPU alla musica che sta suonando.
    try { require('os').setPriority(proc.pid, 10) } catch { /* non critico */ }
    proc.on('error', () => resolve(false)) // ffmpeg assente: si tiene l'originale
    proc.on('close', (code) => resolve(code === 0))
  })
}

// Rimpicciolisce la copertina SUL POSTO se è più larga del bersaglio.
// Torna { ridotta, prima, dopo } — o null se non c'era niente da fare.
// Non lancia mai: una copertina è un di più, e fallire qui non deve poter
// far fallire il download di cui fa parte.
async function shrinkThumbnail(file, ffmpegPath = 'ffmpeg') {
  try {
    const header = readHeader(file)
    const size = header && jpegSize(header)
    // Non è un jpeg leggibile, oppure è già abbastanza piccola: si lascia
    // stare. Ri-comprimere una copertina già a misura peggiorerebbe soltanto
    // la qualità, e renderebbe la migrazione NON idempotente.
    if (!size || size.width <= TARGET_WIDTH) return null

    const before = fs.statSync(file).size
    // File nuovo e poi rename: ffmpeg non sa scrivere sul proprio input, e un
    // rename è atomico — un'interruzione a metà lascia la copertina vecchia
    // intatta invece di un file troncato.
    const tmp = `${file}.tmp.jpg`
    const ok = await runFfmpeg(ffmpegPath, [
      '-y', '-loglevel', 'error', '-i', file,
      '-vf', `scale=${TARGET_WIDTH}:-1`,
      '-q:v', '4',
      tmp
    ])
    if (!ok || !fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp) } catch { /* mai creato */ }
      return null
    }
    fs.renameSync(tmp, file)
    return { ridotta: true, prima: before, dopo: fs.statSync(file).size, larghezzaPrima: size.width }
  } catch {
    return null
  }
}

// Passata di migrazione sulle copertine già scaricate. Idempotente: al secondo
// giro sono tutte sotto il bersaglio e non si tocca niente, quindi può girare a
// ogni avvio senza doversi ricordare se è già stata fatta.
async function shrinkAll(thumbnailsDir, ffmpegPath = 'ffmpeg') {
  const out = { esaminate: 0, ridotte: 0, byteRisparmiati: 0, pixelRisparmiatiMB: 0 }
  let files
  try {
    files = fs.readdirSync(thumbnailsDir).filter((f) => /\.jpe?g$/i.test(f))
  } catch {
    return out
  }
  for (const f of files) {
    out.esaminate += 1
    // In serie, non in parallelo: su due core del 2012 sette ffmpeg insieme
    // sono esattamente il picco di CPU che stiamo cercando di evitare.
    const r = await shrinkThumbnail(path.join(thumbnailsDir, f), ffmpegPath)
    if (!r) continue
    out.ridotte += 1
    out.byteRisparmiati += r.prima - r.dopo
    // Il guadagno che conta davvero: la bitmap decodificata, non il file.
    const before = r.larghezzaPrima * (r.larghezzaPrima * 9 / 16) * 4
    const after = TARGET_WIDTH * (TARGET_WIDTH * 9 / 16) * 4
    out.pixelRisparmiatiMB += (before - after) / 1048576
  }
  out.pixelRisparmiatiMB = Math.round(out.pixelRisparmiatiMB)
  return out
}

module.exports = { shrinkThumbnail, shrinkAll, jpegSize, TARGET_WIDTH }
