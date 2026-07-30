// Pagina /viewer (tablet/browser sulla LAN) e la sua API di polling.
// Lo stato di "cosa si sta mostrando" NON sta qui — è lo stesso stato che
// governa il Chromecast e vive in visuals.js, in un posto solo.
//
// Qui stanno le RISPOSTE, non le rotte: i due host (Express sul server LAN,
// http.createServer nudo nel main process Electron) servono gli stessi due URL
// con API di response diverse. Tenendo qui il corpo, l'ETag, il CORS e la
// pagina di ripiego, i due host restano due righe ciascuno e non possono più
// divergere — cosa già successa: solo l'host Electron aveva il try/catch e
// l'header CORS.
const fs = require('fs')
const path = require('path')
const visuals = require('./visuals')

let html = null
function viewerHtml() {
  if (!html) html = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf-8')
  return html
}

// Il viewer è un extra: se l'HTML non si può leggere (file assente dal
// pacchetto, permessi) si serve una pagina di cortesia. Un throw qui, sull'host
// Electron, sarebbe un'eccezione non gestita dentro http.createServer — cioè il
// main process abbattuto, audio compreso, per una pagina accessoria.
function pageResponse() {
  try {
    return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: viewerHtml() }
  } catch (err) {
    return {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: `Viewer non disponibile: ${err.message}`
    }
  }
}

// Manifest per "aggiungi a schermata Home". È l'unico modo di avere il viewer
// davvero a tutto schermo senza toccare niente: requestFullscreen() esige un
// gesto dell'utente e a caricamento pagina viene sempre rifiutato, mentre una
// pagina lanciata dall'icona con display:fullscreen parte senza barre e senza
// che nessuno prema niente. Il tocco sulla pagina resta come ripiego per chi
// apre il link e basta.
//
// start_url punta a /viewer: l'icona deve aprire il visual, non la soundboard.
function manifestResponse() {
  return {
    status: 200,
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
    body: JSON.stringify({
      name: 'Soundboard Viewer',
      short_name: 'Viewer',
      start_url: '/viewer',
      scope: '/viewer',
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: '#000000',
      theme_color: '#000000'
    })
  }
}

// Il tablet ripassa di qui in continuazione: con un ETag la risposta invariata
// (il caso normale, per ore) è un 304 senza corpo. ts cambia ad ogni visual
// mostrato, quindi basta lui a identificare lo stato.
function currentResponse(ifNoneMatch) {
  const cur = visuals.currentForViewer()
  const etag = `W/"${cur ? cur.ts : 'none'}"`
  // CORS aperto: il viewer può essere aperto dall'origine di un host e
  // interrogare l'altro (server LAN in piedi mentre gira anche il desktop).
  const headers = { ETag: etag, 'Access-Control-Allow-Origin': '*' }
  if (ifNoneMatch === etag) return { status: 304, headers, body: null }
  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(cur)
  }
}

// Fuori escono solo le risposte: l'HTML da solo non serve a nessuno degli host
// e riesportarlo rimetterebbe in circolo la variante che può lanciare.
module.exports = { pageResponse, currentResponse, manifestResponse }
