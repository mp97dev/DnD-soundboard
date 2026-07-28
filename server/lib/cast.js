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
const log = require('./log')

// Log dedicato al cast: la sessione di 4 ore in cui la TV è caduta 3 volte
// senza un errore visibile è nata proprio dalla mancanza di questi dati.
const clog = log.child('cast')

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
    const key = `${host}:${service.port}`
    const isNew = !devices.has(key) // log solo alla prima comparsa, non ad ogni refresh mDNS
    const device = {
      name: (service.txt && service.txt.fn) || service.name,
      host,
      port: service.port || 8009
    }
    devices.set(key, device)
    if (isNew) clog.info('dispositivo scoperto', { name: device.name, host: device.host })
  })
  browser.on('down', (service) => {
    const host = (service.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
    if (host) {
      const key = `${host}:${service.port}`
      const device = devices.get(key)
      clog.info('dispositivo non più visibile', { name: device?.name, host })
      devices.delete(key)
    }
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
    // butta via tutto e riparti con una discovery nuova. Livello warn perché
    // segnala che lo stack di rete è stato disturbato, non solo il cast
    clog.warn('socket mDNS morta, la ricreo')
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
// startedAt sta DENTRO la sessione: è un suo campo, non uno stato parallelo.
// Come variabile separata andava scritta e azzerata in lockstep con `session`
// in ogni percorso — e stop() già se ne dimenticava, lasciando l'orario della
// sessione precedente a falsare l'uptimeSec della successiva. Che è proprio il
// numero su cui si regge l'ipotesi Backdrop (docs/session-test-plan.md §5).
let session = null // { client, player, host, title, startedAt }
let lastShow = null // ultimi argomenti di show(): servono per la riconnessione
let reconnect = null // { startedAt, timer, attempts } quando la sessione è caduta
let watchdog = null
const WATCHDOG_INTERVAL_MS = 30 * 1000

// Punto unico per loggare una perdita di sessione: ci sono 4 modi diversi in
// cui la TV può sparire (error/close del client, close del player, watchdog)
// e per capire se il Default Media Receiver regge le immagini statiche serve
// sapere, per ognuno, da quanto tempo la sessione era su e cosa mostrava.
// Chiamata sempre mentre `session` è ancora valorizzata (i quattro rilevatori
// loggano PRIMA di closeSession): l'uptime è quindi sempre quello della
// sessione appena persa.
function logSessionLoss(detector, extra) {
  const uptimeSec = session ? Math.round((Date.now() - session.startedAt) / 1000) : null
  clog.warn('sessione cast persa', {
    detector,
    uptimeSec,
    contentType: lastShow?.contentType ?? null,
    title: lastShow?.title ?? null,
    ...extra
  })
}

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
  const s = session
  session = null
  try { s.client.close() } catch { /* già chiusa */ }
}

// Riconnessione automatica: quando la sessione cade (blackout, TV che perde
// il WiFi) riprova ogni pochi secondi a rimostrare l'ultimo media, finché la
// TV non torna o l'utente non fa stop.
function scheduleReconnect() {
  if (!lastShow || reconnect) return
  const startedAt = Date.now()
  const attempt = () => {
    if (!reconnect) return
    const elapsedMs = Date.now() - startedAt
    if (elapsedMs > RECONNECT_MAX_MS) {
      clog.warn('reconnect: rinuncio, superato il limite di 10 minuti', {
        elapsedMs,
        attempts: reconnect.attempts
      })
      reconnect = null
      return
    }
    reconnect.attempts += 1
    clog.info('reconnect: tentativo', { attempt: reconnect.attempts, elapsedMs })
    queued(async () => {
      if (!reconnect || !lastShow) return
      try {
        await doShow(lastShow)
        clog.info('reconnect: riuscito', {
          downtimeMs: Date.now() - startedAt,
          attempts: reconnect.attempts
        })
        reconnect = null
      } catch {
        if (reconnect) reconnect.timer = setTimeout(attempt, RECONNECT_INTERVAL_MS)
      }
    })
  }
  reconnect = { startedAt, timer: setTimeout(attempt, RECONNECT_INTERVAL_MS), attempts: 0 }
}

function cancelReconnect() {
  if (!reconnect) return
  clearTimeout(reconnect.timer)
  reconnect = null
}

// Sonda periodica: getStatus tiene viva la connessione e rileva il caso in cui
// la TV ha chiuso il receiver senza che arrivi alcun evento. Se il Default
// Media Receiver non è più tra le app attive, la sessione è persa: riparte
// la riconnessione automatica (ri-mostra l'ultimo media).
function ensureWatchdog() {
  if (watchdog) return
  // Debug e non info: è avvio/arresto di un meccanismo interno, non un evento
  // di sessione. Niente riga periodica ogni 30s, sarebbe rumore su 4 ore.
  clog.debug('watchdog avviato')
  watchdog = setInterval(() => {
    if (!session) {
      // Niente sessione e niente riconnessione in corso: il watchdog non serve
      if (!reconnect) {
        clearInterval(watchdog)
        watchdog = null
        clog.debug('watchdog fermato')
      }
      return
    }
    const s = session
    try {
      s.client.getStatus((err, st) => {
        if (session !== s) return // sessione cambiata nel frattempo
        const appPresent = !err && (st?.applications || []).some(
          (a) => a.appId === DefaultMediaReceiver.APP_ID
        )
        const alive = !err && appPresent
        if (!alive) {
          // Distinguere le due cause: un errore di probe è un problema di
          // rete/socket, un receiver assente è la TV che ha davvero mollato
          // l'app (l'ipotesi Backdrop/ambient mode che questa strumentazione
          // vuole confermare)
          logSessionLoss('watchdog', {
            probeError: err ? err.message : null,
            reason: err ? 'errore probe getStatus' : 'receiver assente dalle app attive'
          })
          closeSession()
          scheduleReconnect()
        }
      })
    } catch (err) {
      logSessionLoss('watchdog', { probeError: err.message, reason: 'eccezione sincrona da getStatus' })
      closeSession()
      scheduleReconnect()
    }
  }, WATCHDOG_INTERVAL_MS)
}

function connect(host) {
  const startedAt = Date.now()
  clog.info('connect: tentativo', { host })
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    // castv2 non ha un timeout di connessione: senza questo, una TV
    // irraggiungibile lascia la UI appesa per minuti (timeout TCP)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      clog.warn('connect: timeout di 8s scaduto', { host, elapsedMs: Date.now() - startedAt })
      try { client.close() } catch { /* mai aperta */ }
      reject(new Error(`TV non raggiungibile (${host})`))
    }, CONNECT_TIMEOUT_MS)
    client.on('error', (err) => {
      // Connessione caduta (TV spenta, rete): la sessione non è più valida.
      // Se stavamo mostrando qualcosa, parte la riconnessione automatica.
      if (session && session.client === client) {
        logSessionLoss('client-error', { err: err.message })
        closeSession()
        scheduleReconnect()
      }
      if (!settled) {
        settled = true
        clearTimeout(timer)
        clog.warn('connect: fallita', { host, elapsedMs: Date.now() - startedAt, err: err.message })
        reject(err)
      }
    })
    client.on('close', () => {
      // Socket chiusa senza 'error' (TV che termina la connessione con garbo)
      if (session && session.client === client) {
        logSessionLoss('client-close')
        closeSession()
        scheduleReconnect()
      }
    })
    client.connect(host, () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clog.info('connect: riuscita', { host, elapsedMs: Date.now() - startedAt })
      resolve(client)
    })
  })
}

// Ogni passo dell'avvio (launch/load/queueLoad) è la stessa cosa tre volte: un
// callback castv2 che, se la socket muore nel frattempo, non arriva MAI — da
// cui il tetto massimo, senza il quale la UI resta appesa — più il tempo che
// ci ha messo, l'unico dato che dice se una TV è lenta o irraggiungibile.
// `name` distingue nel log quale dei tre è scaduto.
function step({ name, ms, timeoutMsg, doneMsg }, run) {
  const startedAt = Date.now()
  let timer
  let timedOut = false
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new Error(timeoutMsg))
    }, ms)
  })
  return Promise.race([new Promise(run), timeout])
    .then((value) => {
      clog.info(doneMsg, { elapsedMs: Date.now() - startedAt })
      return value
    })
    .finally(() => {
      clearTimeout(timer)
      if (timedOut) clog.warn('timeout in fase di avvio cast', { step: name, ms })
    })
}

function launch(client) {
  return step(
    { name: 'launch', ms: 10000, timeoutMsg: 'La TV non ha avviato il receiver (timeout)', doneMsg: 'receiver avviato' },
    (resolve, reject) => client.launch(DefaultMediaReceiver, (err, player) => (err ? reject(err) : resolve(player)))
  )
}

function loadMedia(player, media) {
  return step(
    { name: 'load', ms: 15000, timeoutMsg: 'La TV non ha caricato il media (timeout)', doneMsg: 'media caricato' },
    (resolve, reject) => player.load(media, { autoplay: true }, (err, status) => (err ? reject(err) : resolve(status)))
  )
}

// Loop nativo del receiver: coda con un solo item e REPEAT_ALL. Nessun gap
// a fine riproduzione, a differenza del reload manuale su IDLE/FINISHED.
function loadMediaLooping(player, media) {
  return step(
    { name: 'queueLoad', ms: 15000, timeoutMsg: 'La TV non ha caricato il media (timeout)', doneMsg: 'media in loop caricato' },
    (resolve, reject) => player.queueLoad(
      [{ media, autoplay: true }],
      { repeatMode: 'REPEAT_ALL' },
      (err, status) => (err ? reject(err) : resolve(status))
    )
  )
}

// Mostra un media sul Chromecast. contentType decide il comportamento:
// video → loop automatico (repeatMode del receiver), immagine → resta.
function show(args) {
  return queued(() => {
    cancelReconnect()
    lastShow = args
    clog.info('show', { host: args.host, title: args.title, contentType: args.contentType })
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
      } catch (err) {
        // Receiver senza supporto alle code: fallback al reload manuale
        // quando il video finisce (IDLE/FINISHED). File in cache HTTP →
        // ripartenza rapida ma con un breve gap. Warn perché è la TV che
        // rifiuta queueLoad, utile da sapere quali modelli lo fanno.
        clog.warn('queueLoad rifiutata dal receiver, fallback al reload manuale', { err: err.message })
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
  session = { client, player, host, title, startedAt: Date.now() }
  // La TV può chiudere il receiver (torna alla home) lasciando la socket viva:
  // l'evento 'close' dell'application è l'unico segnale
  player.on('close', () => {
    if (session && session.player === player) {
      logSessionLoss('player-close')
      closeSession()
      scheduleReconnect()
    }
  })
  ensureWatchdog()
  return { casting: true, title }
}

// Schermo nero SENZA chiudere la sessione: usato da "Ferma tutto" così la TV
// resta connessa e pronta per il prossimo visual. url punta a /blank.png del
// nostro media server.
function blank({ url }) {
  return queued(async () => {
    clog.info('blank', { url })
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
    clog.info('stop', { title: session?.title ?? lastShow?.title ?? null })
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
