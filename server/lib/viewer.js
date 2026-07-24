// Stato del visual corrente per la pagina /viewer (tablet/browser sulla LAN).
// Tiene il percorso ORIGINALE del media (non la variante HLS del Chromecast):
// i browser riproducono direttamente mp4/immagini da /media/.
const fs = require('fs')
const path = require('path')

let current = null // { rel, contentType, title, ts }

function setCurrent(rel, contentType, title = '') {
  current = { rel, contentType, title, ts: Date.now() }
}
function clear() { current = null }
function getCurrent() { return current }

let html = null
function viewerHtml() {
  if (!html) html = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf-8')
  return html
}

module.exports = { setCurrent, clear, getCurrent, viewerHtml }
