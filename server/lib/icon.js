// Icona del viewer, disegnata qui invece che tenuta come file binario.
//
// Perché serve: senza icons nel manifest, Chrome NON considera la pagina
// installabile, e "Aggiungi a schermata Home" crea una scorciatoia qualsiasi
// che si apre nel browser con le sue barre. Cioè display:fullscreen non viene
// mai applicato e il motivo per cui il manifest esiste sparisce.
//
// Generata a codice perché nel repo non c'è nessuno strumento per le immagini
// e un PNG committato a mano non si potrebbe più rileggere né correggere. Il
// disegno è uno schermo con dentro un triangolo di riproduzione, ottone su
// bruno: gli stessi colori del tema candela.
const zlib = require('zlib')

const BG = [0x17, 0x13, 0x0f]
const FG = [0xc9, 0x92, 0x2f]

// CRC32 come lo vuole il PNG. Tabella calcolata una volta sola.
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 8 bit per canale
  ihdr[9] = 2 // colorType 2 = RGB senza alfa: l'icona è piena, l'alfa sarebbe peso inutile
  // 10,11,12 restano 0: deflate, filtro adattivo, nessun interlacciamento
  const stride = size * 3
  // Ogni riga è preceduta dal suo byte di filtro (0 = nessuno)
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// Copertura del pixel (0..1) campionando 4x4 sottopunti. Senza, i bordi curvi
// del riquadro e i lati obliqui del triangolo verrebbero a scalini, che a
// 192px sull'icona di un tablet si vedono benissimo.
function coverage(x, y, inside) {
  let hits = 0
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++
    }
  }
  return hits / 16
}

function render(size) {
  const rgb = Buffer.alloc(size * size * 3)
  const s = size
  // Riquadro dello schermo, con angoli arrotondati, disegnato come bordo
  const m = s * 0.18 // margine
  const r = s * 0.09 // raggio degli angoli
  const t = s * 0.07 // spessore del bordo
  const x0 = m, y0 = m * 1.15, x1 = s - m, y1 = s - m * 1.15

  const inRounded = (px, py, inset) => {
    const ax0 = x0 + inset, ay0 = y0 + inset, ax1 = x1 - inset, ay1 = y1 - inset
    const rr = Math.max(0, r - inset)
    if (px < ax0 || px > ax1 || py < ay0 || py > ay1) return false
    const cx = Math.min(Math.max(px, ax0 + rr), ax1 - rr)
    const cy = Math.min(Math.max(py, ay0 + rr), ay1 - rr)
    const dx = px - cx, dy = py - cy
    return dx * dx + dy * dy <= rr * rr
  }
  // Triangolo di riproduzione al centro
  const tw = s * 0.16, th = s * 0.19
  const tx = s / 2 - tw * 0.35, ty = s / 2
  const inTriangle = (px, py) => {
    if (px < tx || px > tx + tw) return false
    const half = (th / 2) * (1 - (px - tx) / tw)
    return Math.abs(py - ty) <= half
  }

  const isOn = (px, py) =>
    (inRounded(px, py, 0) && !inRounded(px, py, t)) || inTriangle(px, py)

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const a = coverage(x, y, isOn)
      const o = (y * s + x) * 3
      for (let c = 0; c < 3; c++) rgb[o + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a)
    }
  }
  return rgb
}

// Le due misure che Chrome vuole per considerare la pagina installabile.
// Calcolate una volta e tenute: sono ~10 KB in tutto e l'icona non cambia.
const cache = new Map()
function iconPng(size) {
  if (!cache.has(size)) cache.set(size, encodePng(size, render(size)))
  return cache.get(size)
}

function iconResponse(size) {
  const body = iconPng(size)
  return {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(body.length),
      'Cache-Control': 'public, max-age=86400'
    },
    body
  }
}

module.exports = { iconPng, iconResponse, SIZES: [192, 512] }
