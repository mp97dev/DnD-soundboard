// Orchestrazione del visual corrente: cosa va sulla TV (Chromecast) e cosa va
// sulla pagina /viewer (tablet/browser sulla LAN). Sono due superfici diverse
// con una regola sola, e la regola vive QUI.
//
// Prima era scritta due volte — una per il server LAN Express, una per il main
// process Electron — e le due copie erano già divergenti: viewer.clear() dentro
// o fuori dal try a seconda dell'host, l'URL del media concatenato a mano in
// tre punti, e nessuna delle due che sapesse dire alla UI QUALE visual è
// attivo (il renderer se lo ricordava per conto suo, e lo perdeva ad ogni
// reload mentre TV e tablet continuavano a mostrare l'immagine).
//
// Gli host restano responsabili solo di ciò che è davvero diverso fra i due:
// da quale URL sono raggiungibili (urlBase) e dove trovano ffmpeg.
const cast = require('./cast')
const { contentTypeFor } = require('./media')
const { ensureLoopPlaylist } = require('./hlsloop')

// Unica fonte di verità per "cosa c'è su schermo". Tiene il percorso
// ORIGINALE del media, non la variante HLS costruita per il Chromecast: i
// browser riproducono direttamente mp4/immagini da /media/.
let current = null // { rel, contentType, title, visualId, host, ts }

function mediaUrl(urlBase, rel) {
  return `${urlBase}/media/${rel.split('/').map(encodeURIComponent).join('/')}`
}

// host null = modalità solo-viewer: nessuna TV selezionata, il visual esiste
// comunque per il tablet. urlBase serve solo quando c'è una TV da contattare
// (è la TV a doverci scaricare il media), quindi in solo-viewer può essere null.
async function show({ host, mediaPath, title = '', visualId = null, urlBase, dataDir, ffmpegPath }) {
  const contentType = contentTypeFor(mediaPath)
  // Il viewer viene aggiornato PRIMA di contattare la TV, e resta aggiornato
  // anche se la TV non risponde: il tablet è una superficie indipendente, non
  // un riflesso della sessione cast.
  current = { rel: mediaPath, contentType, title, visualId, host: host || null, ts: Date.now() }
  if (!host) return { casting: false, visualId }

  // Video → HLS con playlist che ripete i segmenti: loop senza overlay né
  // reload sul receiver. Se la segmentazione non riesce, mp4 diretto.
  let rel = mediaPath
  let castType = contentType
  if (contentType.startsWith('video/')) {
    const hls = await ensureLoopPlaylist({ dataDir, mediaRel: mediaPath, ffmpegPath })
    if (hls) {
      rel = hls
      castType = 'application/vnd.apple.mpegurl'
    }
  }
  const res = await cast.show({ host, url: mediaUrl(urlBase, rel), contentType: castType, title })
  return { ...res, visualId }
}

// Schermo nero senza staccare la sessione TV ("Ferma tutto"): sul tablet
// significa tornare allo stato di attesa.
function blank({ urlBase }) {
  current = null
  return cast.blank({ url: `${urlBase}/blank.png` })
}

function stop() {
  current = null
  return cast.stop()
}

// Payload della pagina /viewer: solo i campi che le servono per disegnare.
// visualId e host sono roba nostra e non hanno motivo di uscire sulla LAN.
function currentForViewer() {
  if (!current) return null
  const { rel, contentType, title, ts } = current
  return { rel, contentType, title, ts }
}

function status() {
  const st = cast.status()
  // Quale visual la UI deve mostrare come attivo. In solo-viewer resta acceso
  // finché il tablet lo mostra; con una TV agganciata si spegne quando la
  // sessione è persa e non c'è più una riconnessione in corso. Prima la regola
  // stava nel renderer, che per applicarla doveva leggersi le impostazioni per
  // sapere se una TV fosse selezionata.
  const onScreen = current && (!current.host || st.casting || st.reconnecting)
  return { ...st, visualId: onScreen ? current.visualId : null }
}

function viewerUrl(urlBase) {
  return `${urlBase}/viewer`
}

module.exports = { show, blank, stop, currentForViewer, status, viewerUrl }
