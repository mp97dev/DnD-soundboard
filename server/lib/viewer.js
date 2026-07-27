// Pagina /viewer (tablet/browser sulla LAN): qui solo il caricamento dell'HTML.
// Lo stato di "cosa si sta mostrando" NON sta qui — è lo stesso stato che
// governa il Chromecast e vive in visuals.js, in un posto solo.
const fs = require('fs')
const path = require('path')

let html = null
function viewerHtml() {
  if (!html) html = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf-8')
  return html
}

module.exports = { viewerHtml }
