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
  try { browser.update() } catch { /* ignora */ }
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
let session = null // { client, player, host }

function closeSession() {
  if (!session) return
  try { session.client.close() } catch { /* già chiusa */ }
  session = null
}

function connect(host) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.on('error', (err) => {
      // Connessione caduta (TV spenta, rete): la sessione non è più valida
      if (session && session.client === client) closeSession()
      reject(err)
    })
    client.connect(host, () => resolve(client))
  })
}

function launch(client) {
  return new Promise((resolve, reject) => {
    client.launch(DefaultMediaReceiver, (err, player) =>
      err ? reject(err) : resolve(player)
    )
  })
}

function loadMedia(player, media) {
  return new Promise((resolve, reject) => {
    player.load(media, { autoplay: true }, (err, status) =>
      err ? reject(err) : resolve(status)
    )
  })
}

// Loop nativo del receiver: coda con un solo item e REPEAT_ALL. Nessun gap
// a fine riproduzione, a differenza del reload manuale su IDLE/FINISHED.
function loadMediaLooping(player, media) {
  return new Promise((resolve, reject) => {
    player.queueLoad(
      [{ media, autoplay: true }],
      { repeatMode: 'REPEAT_ALL' },
      (err, status) => (err ? reject(err) : resolve(status))
    )
  })
}

// Mostra un media sul Chromecast. contentType decide il comportamento:
// video → loop automatico (repeatMode del receiver), immagine → resta.
async function show({ host, url, contentType, title = '', loop = true }) {
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

async function stop() {
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
}

function status() {
  return { casting: !!session, title: session?.title ?? null }
}

module.exports = { listDevices, lanIp, show, stop, status }
