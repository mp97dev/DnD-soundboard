// Controllo Chromecast dal processo Node (server LAN o main process Electron).
// Il cast NON parte dal browser/renderer: il Node locale ordina al Chromecast
// (protocollo Google Cast, porta 8009) di scaricare il media dal nostro
// server HTTP. Serve quindi un URL raggiungibile dalla TV sulla LAN.
//
// - Discovery: mDNS (_googlecast._tcp) via bonjour-service, cache aggiornata
//   in continuo finché il processo vive.
// - Playback: castv2-client + Default Media Receiver (l'app "TV di default"
//   di Google, nessuna app custom da registrare). Immagini e video H.264/AAC
//   in mp4 sono i formati sicuri su tutti i Chromecast.
const { Client, DefaultMediaReceiver } = require('castv2-client')
const os = require('os')

// ---- Discovery ----
let bonjour = null
let browser = null
const devices = new Map() // "host:port" -> { name, host, port }

function startDiscovery() {
  if (browser) return
  const { Bonjour } = require('bonjour-service')
  bonjour = new Bonjour()
  browser = bonjour.find({ type: 'googlecast' }, (service) => {
    const host = (service.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
    if (!host) return
    devices.set(`${host}:${service.port}`, {
      name: (service.txt && service.txt.fn) || service.name,
      host,
      port: service.port || 8009
    })
  })
  browser.on('down', (service) => {
    const host = (service.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
    if (host) devices.delete(`${host}:${service.port}`)
  })
}

function listDevices() {
  startDiscovery()
  // update() rilancia la query mDNS: i dispositivi apparsi dopo l'avvio
  // rispondono alla prossima chiamata
  try {
    browser.update()
  } catch {
    // Socket mDNS morta (rete caduta/cambiata, es. blackout del router):
    // butta via tutto e riparti con una discovery nuova
    try { bonjour.destroy() } catch { /* già morta */ }
    bonjour = null
    browser = null
    devices.clear()
    startDiscovery()
  }
  return [...devices.values()]
}

// ---- IP LAN ----
// L'URL del media va costruito con l'IP della macchina sulla LAN: localhost
// per il Chromecast è sé stesso.
function lanIp() {
  const ifaces = os.networkInterfaces()
  const candidates = []
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) candidates.push(i.address)
    }
  }
  // Preferisce le classi private "domestiche" (192.168, 10.) rispetto a
  // interfacce virtuali (docker, WSL) che la TV non raggiunge
  const score = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : 2)
  candidates.sort((a, b) => score(a) - score(b))
  return candidates[0] || null
}

// ---- Sessione di cast ----
let session = null // { client, player, host, title }
let lastShow = null // ultimi argomenti di show(): servono per la riconnessione
let reconnect = null // { startedAt, timer } quando la sessione è caduta

const CONNECT_TIMEOUT_MS = 8000
const RECONNECT_INTERVAL_MS = 5000
const RECONNECT_MAX_MS = 10 * 60 * 1000 // poi molliamo (TV spenta di proposito)

// show/stop/blank/riconnessioni serializzate: due load concorrenti sulla
// stessa TV lasciano socket appese e receiver fantasma
let chain = Promise.resolve()
function queued(fn) {
  const p = chain.then(fn)
  chain = p.then(() => {}, () => {})
  return p
}

function closeSession() {
  if (!session) return
  try { session.client.close() } catch { /* già chiusa */ }
  session = null
}

// Riconnessione automatica: quando la sessione cade (blackout, TV che perde
// il WiFi) riprova ogni pochi secondi a rimostrare l'ultimo media, finché la
// TV non torna o l'utente non fa stop.
function scheduleReconnect() {
  if (!lastShow || reconnect) return
  const startedAt = Date.now()
  const attempt = () => {
    if (!reconnect) return
    if (Date.now() - startedAt > RECONNECT_MAX_MS) {
      reconnect = null
      return
    }
    queued(async () => {
      if (!reconnect || !lastShow) return
      try {
        await doShow(lastShow)
        reconnect = null
      } catch {
        if (reconnect) reconnect.timer = setTimeout(attempt, RECONNECT_INTERVAL_MS)
      }
    })
  }
  reconnect = { startedAt, timer: setTimeout(attempt, RECONNECT_INTERVAL_MS) }
}

function cancelReconnect() {
  if (!reconnect) return
  clearTimeout(reconnect.timer)
  reconnect = null
}

function connect(host) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    // castv2 non ha un timeout di connessione: senza questo, una TV
    // irraggiungibile lascia la UI appesa per minuti (timeout TCP)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { client.close() } catch { /* mai aperta */ }
      reject(new Error(`TV non raggiungibile (${host})`))
    }, CONNECT_TIMEOUT_MS)
    client.on('error', (err) => {
      // Connessione caduta (TV spenta, rete): la sessione non è più valida.
      // Se stavamo mostrando qualcosa, parte la riconnessione automatica.
      if (session && session.client === client) {
        closeSession()
        scheduleReconnect()
      }
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })
    client.connect(host, () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(client)
    })
  })
}

// Se la socket muore tra connect e launch/load, i callback castv2 non
// arrivano mai: ogni passo ha un tetto massimo per non appendere la UI
function withTimeout(promise, ms, msg) {
  let t
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(msg)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

function launch(client) {
  return withTimeout(
    new Promise((resolve, reject) => {
      client.launch(DefaultMediaReceiver, (err, player) =>
        err ? reject(err) : resolve(player)
      )
    }),
    10000,
    'La TV non ha avviato il receiver (timeout)'
  )
}

function loadMedia(player, media) {
  return withTimeout(
    new Promise((resolve, reject) => {
      player.load(media, { autoplay: true }, (err, status) =>
        err ? reject(err) : resolve(status)
      )
    }),
    15000,
    'La TV non ha caricato il media (timeout)'
  )
}

// Loop nativo del receiver: coda con un solo item e REPEAT_ALL. Nessun gap
// a fine riproduzione, a differenza del reload manuale su IDLE/FINISHED.
function loadMediaLooping(player, media) {
  return withTimeout(
    new Promise((resolve, reject) => {
      player.queueLoad(
        [{ media, autoplay: true }],
        { repeatMode: 'REPEAT_ALL' },
        (err, status) => (err ? reject(err) : resolve(status))
      )
    }),
    15000,
    'La TV non ha caricato il media (timeout)'
  )
}

// Mostra un media sul Chromecast. contentType decide il comportamento:
// video → loop automatico (repeatMode del receiver), immagine → resta.
function show(args) {
  return queued(() => {
    cancelReconnect()
    lastShow = args
    return doShow(args)
  })
}

async function doShow({ host, url, contentType, title = '', loop = true }) {
  if (!host) throw new Error('Nessun dispositivo Chromecast selezionato')
  closeSession()

  const client = await connect(host)
  let player
  try {
    player = await launch(client)
  } catch (err) {
    // La connessione è aperta ma il receiver non è partito: senza close
    // resterebbe una socket TLS appesa verso la TV
    try { client.close() } catch { /* ignora */ }
    throw err
  }

  const media = {
    contentId: url,
    contentType,
    streamType: 'BUFFERED',
    metadata: { type: 0, metadataType: 0, title }
  }

  const isVideo = contentType.startsWith('video/')
  try {
    if (isVideo && loop) {
      try {
        await loadMediaLooping(player, media)
      } catch {
        // Receiver senza supporto alle code: fallback al reload manuale
        // quando il video finisce (IDLE/FINISHED). File in cache HTTP →
        // ripartenza rapida ma con un breve gap.
        player.on('status', (st) => {
          if (
            session && session.player === player &&
            st.playerState === 'IDLE' && st.idleReason === 'FINISHED'
          ) {
            player.load(media, { autoplay: true }, () => { /* best effort */ })
          }
        })
        await loadMedia(player, media)
      }
    } else {
      await loadMedia(player, media)
    }
  } catch (err) {
    try { client.close() } catch { /* ignora */ }
    throw err
  }
  session = { client, player, host, title }
  return { casting: true, title }
}

// Schermo nero SENZA chiudere la sessione: usato da "Ferma tutto" così la TV
// resta connessa e pronta per il prossimo visual. url punta a /blank.png del
// nostro media server.
function blank({ url }) {
  return queued(async () => {
    // D'ora in poi l'ultimo media è il nero: se la sessione cade e si
    // riconnette, torna al nero e non al visual fermato
    if (lastShow) lastShow = { ...lastShow, url, contentType: 'image/png', title: '', loop: false }
    if (!session) return { casting: false, reconnecting: !!reconnect }
    const media = {
      contentId: url,
      contentType: 'image/png',
      streamType: 'BUFFERED',
      metadata: { type: 0, metadataType: 0, title: '' }
    }
    try {
      await loadMedia(session.player, media)
      session.title = ''
    } catch {
      // Sessione morta: la chiude, ci penserà la riconnessione (→ nero)
      closeSession()
      scheduleReconnect()
    }
    return { casting: !!session, title: '', reconnecting: !!reconnect }
  })
}

function stop() {
  return queued(async () => {
    cancelReconnect()
    lastShow = null
    if (!session) return { casting: false }
    const { client, player } = session
    session = null
    await new Promise((resolve) => {
      try {
        client.stop(player, () => resolve())
      } catch {
        resolve()
      }
    })
    try { client.close() } catch { /* ignora */ }
    return { casting: false }
  })
}

function status() {
  return {
    casting: !!session,
    title: session?.title ?? null,
    reconnecting: !!reconnect
  }
}

module.exports = { listDevices, lanIp, show, blank, stop, status }
