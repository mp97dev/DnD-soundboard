// Motore audio basato su Web Audio API.
// Canali: Music (esclusivo), Ambience (additivo), One-Shot (transiente).
// I file audio sono serviti via mediaUrl(): protocollo media:// in Electron,
// rotta HTTP /media/ quando il renderer gira nel browser (server LAN).
import { mediaUrl } from '../media'
import { child, rateLimited } from '../log'
//
// Music e ambience (file lunghi, in loop) vanno in STREAMING con
// HTMLAudioElement: partenza immediata e niente PCM decodificato in RAM
// (1h stereo decodificata ≈ 1.2 GB). I one-shot restano su AudioBuffer
// per trigger istantanei e sovrapponibili.
//
// STORIA: fino a qui music/ambience uscivano comunque tramite
// ctx.createMediaElementSource(el), per poterle mixare con un GainNode nel
// grafo Web Audio. Era il bug: agganciare un MediaElementSource toglie
// Chromium dal suo output dedicato per i media (AudioRendererImpl, buffer
// adattivo profondo, ri-bufferizzazione esplicita) e lo sposta sul render
// callback a dimensione fissa dell'AudioContext, dimensionato una volta sola
// alla creazione del context. Quel grafo gira nel processo renderer: uno
// stallo del renderer (GC, swap pressure da altre app) diventa un buco
// audio udibile. In più un <audio> semplice segue il sink di default del SO
// ai cambi di device, mentre l'AudioContext lega stream e sample rate alla
// costruzione — costruzione che qui avviene a livello di modulo, prima
// ancora che l'utente scelga un output. Un cambio di profilo Bluetooth
// A2DP/HSP sotto i piedi non viene recuperato. Sintomo reale: sessione di
// 4 ore su Ubuntu con cassa Bluetooth, la musica ha scattato e poi è
// ammutolita per sempre, serviva riavviare manualmente la traccia.
// Fix: music/ambience suonano l'HTMLAudioElement DIRETTAMENTE (niente
// MediaElementSource, niente GainNode), con recovery attiva su stallo/
// errore/cambio device. I one-shot restano su AudioBuffer+GainNode: per un
// trigger istantaneo e sovrapponibile l'AudioContext è comunque la scelta
// giusta, e un suo eventuale stallo qui è meno grave (niente loop lunghi).

// latencyHint 'playback': buffer di output più grande, meno underrun
// (click/stutter) su macchine lente o con driver audio Windows/WSL capricciosi.
// La latenza extra (~decine di ms) è irrilevante per una soundboard.
const ctx = new AudioContext({ latencyHint: 'playback' })
const masterGain = ctx.createGain()
masterGain.connect(ctx.destination)

const logger = child('audio')
// sampleRate/baseLatency dicono cosa ci ha dato davvero il driver audio: utile
// per diagnosticare stutter segnalati su macchine specifiche.
logger.info('AudioContext inizializzato', { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency })

// Cache dei soli one-shot: file brevi, footprint contenuto
const bufferCache = new Map()

async function loadBuffer(audioPath) {
  if (bufferCache.has(audioPath)) return bufferCache.get(audioPath)
  const res = await fetch(mediaUrl(audioPath))
  if (!res.ok) throw new Error(`Audio non trovato: ${audioPath}`)
  const buf = await ctx.decodeAudioData(await res.arrayBuffer())
  bufferCache.set(audioPath, buf)
  return buf
}

// Master volume applicato "a mano" sugli stream (vedi sotto il perché) e
// gestore d'errore esterno (vedi F: notifica la UI invece di fallire muti).
let masterVolume = 1
let errorHandler = null

// Voci di stream vive (music + ambience): servono per riapplicare il master
// dopo un cambio device e per farle ripartire se un cambio di sink le lascia
// in pausa. I one-shot NON entrano qui: sono fire-and-forget, non hanno uno
// stato "vivo" da monitorare.
const liveStreamVoices = new Set()

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

// Interfaccia voice comune a buffer e stream, così fadeIn/fadeOutAndStop e i
// canali (music/ambience) non devono sapere quale motore sta dietro:
//   setVolume(v)          — immediato, v è il volume RELATIVO ALLA TRACCIA (0..1)
//   fadeTo(v, ms, onDone) — rampa esponenziale verso v in ms millisecondi
//   start()               — async: gli stream aprono il socket/decoder
//   stop(afterMs)         — rilascia le risorse dopo afterMs (lascia finire un fade)
//   applyMaster()         — ricalcola l'uscita dopo un cambio di masterVolume
//                           (no-op per i buffer: il master lì è già nel grafo)

function makeBufferVoice(buffer, { loop = false, volume = 1 } = {}) {
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = loop
  const gain = ctx.createGain()
  gain.gain.value = volume
  source.connect(gain)
  gain.connect(masterGain)
  source.onended = () => gain.disconnect()
  let fadeDoneTimer = null
  return {
    setVolume(v) {
      gain.gain.cancelScheduledValues(ctx.currentTime)
      gain.gain.setValueAtTime(v, ctx.currentTime)
    },
    fadeTo(v, ms, onDone) {
      const now = ctx.currentTime
      const tau = Math.max(ms, 1) / 1000 / 4 // a 4τ il decay è al ~98%
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.setTargetAtTime(v, now, tau)
      clearTimeout(fadeDoneTimer)
      if (onDone) fadeDoneTimer = setTimeout(onDone, ms)
    },
    start: () => source.start(),
    stop: (afterMs = 0) => source.stop(ctx.currentTime + afterMs / 1000 + 0.05),
    // Il master qui è già dentro al grafo (gain -> masterGain): niente da
    // ricalcolare a mano quando cambia.
    applyMaster() {}
  }
}

const MAX_REBUILD_ATTEMPTS = 5 // oltre, il file è probabilmente sparito davvero: arrenditi
const STALL_TIMEOUT_MS = 3000 // abbastanza per un blip di rete, non tanto da sembrare bloccati
// Dopo questo tempo di riproduzione senza incidenti il budget di ricostruzioni
// torna pieno: il tetto di MAX_REBUILD_ATTEMPTS deve valere per UN guasto in
// corso, non per l'intera sessione. Senza questo, cinque blip Bluetooth
// distribuiti su quattro ore di gioco esaurirebbero il budget e la traccia
// resterebbe morta per sempre — esattamente lo scenario che stiamo correggendo.
const STABLE_PLAYBACK_MS = 15000
const FADE_TICK_MS = 50 // granularità della rampa esponenziale sull'elemento

// Il guasto tipico (cassa Bluetooth che sparisce, cambio di profilo A2DP/HSP)
// non colpisce UN file: colpisce l'uscita audio, quindi tutte le voci vive
// insieme. Senza coordinamento, musica + 4 ambience ricostruiscono in
// parallelo — fino a 25 teardown di elementi e altrettante play() addosso a un
// sink che è ancora giù. Le ricostruzioni prendono un turno in una coda
// globale: stesso backoff per voce, ma distanziate fra loro.
const REBUILD_SLOT_MS = 250
let nextRebuildSlot = 0

function reserveRebuildSlot(backoffMs) {
  const now = Date.now()
  const at = Math.max(now + backoffMs, nextRebuildSlot)
  nextRebuildSlot = at + REBUILD_SLOT_MS
  return at - now
}

// Un guasto del sink fa fallire più voci in pochi istanti: la UI ha un solo
// posto dove mostrare l'errore e vincerebbe l'ultima traccia in ordine
// casuale. Contiamo i guasti ravvicinati e lasciamo che sia la UI a dire
// "l'audio è saltato su N tracce" invece di nominarne una a caso.
const ERROR_BURST_MS = 5000
let lastErrorAt = 0
let errorBurstCount = 0

function notifyError(info) {
  const now = Date.now()
  errorBurstCount = now - lastErrorAt < ERROR_BURST_MS ? errorBurstCount + 1 : 1
  lastErrorAt = now
  errorHandler?.({ ...info, count: errorBurstCount })
}

function makeStreamVoice(audioPath, { loop = false, volume = 1, trackId = null, kind = 'stream' } = {}) {
  // Due valori distinti e non intercambiabili: trackVolume è il volume
  // CONFIGURATO della traccia (quello che l'utente ha scelto), outputVolume è
  // quello istantaneo, che durante un fade sta scivolando verso il primo.
  // Tenerne uno solo significava che ogni tick di rampa riscriveva il volume
  // "configurato", e la rampa successiva ripartiva da un valore parziale.
  let trackVolume = volume
  let outputVolume = volume
  let el = null
  let playing = false // true da start() riuscito a stop(): usato per il resume post-devicechange
  let destroyed = false // stop() già richiesto: non ricostruire più
  let currentTimeSaved = 0
  let rebuildAttempts = 0
  let stallTimer = null
  let rebuildTimer = null
  let stableTimer = null
  let fadeInterval = null
  let fade = null // { from, target, tau, ms, startedAt, onDone } della rampa in corso
  // Un AbortController per elemento: staccare i listener è obbligatorio prima
  // di rilasciarne uno, vedi releaseElement().
  let elAbort = null

  function computeVolume() {
    // output*master può superare 1 (entrambi possono essere >1): l'elemento
    // lancia un'eccezione su volume fuori range, va sempre clampato. Un valore
    // non finito lancia allo stesso modo (e clamp01(NaN) resta NaN): questo è
    // l'unico punto da cui esce un volume, qui il fallback vale per tutti.
    const v = outputVolume * masterVolume
    return Number.isFinite(v) ? clamp01(v) : 1
  }

  function applyVolume() {
    el.volume = computeVolume()
  }

  function stopFade() {
    clearInterval(fadeInterval)
    fadeInterval = null
    fade = null
  }

  // Un tick solo per voce, condiviso da tutte le rampe che si susseguono:
  // ripuntare il fade a un nuovo target aggiorna `fade`, non ricrea il timer.
  function fadeTick() {
    if (!fade) return stopFade()
    const t = Date.now() - fade.startedAt
    const value = fade.target + (fade.from - fade.target) * Math.exp(-t / fade.tau)
    outputVolume = value
    applyVolume()
    if (t > fade.ms || Math.abs(value - fade.target) < 0.001) {
      const onDone = fade.onDone
      outputVolume = fade.target
      applyVolume()
      stopFade()
      onDone?.()
    }
  }

  function clearStallTimer() {
    if (stallTimer) {
      clearTimeout(stallTimer)
      stallTimer = null
    }
  }

  function armStallTimer(reason) {
    if (stallTimer) return // già armato: lascialo scadere, non riavviarlo ad ogni evento
    stallTimer = setTimeout(() => {
      stallTimer = null
      logger.warn('stream fermo da troppo tempo, ricostruzione', { path: audioPath, reason })
      rebuild('stall')
    }, STALL_TIMEOUT_MS)
  }

  // Tutti i listener sono legati al signal dell'elemento: quando l'elemento
  // viene sostituito il suo AbortController li stacca in blocco. Senza,
  // l'elemento vecchio continuerebbe a pilotare lo stato CONDIVISO della voce
  // (armStallTimer, currentTimeSaved, rebuild) mentre il nuovo suona bene.
  function attachListeners(mediaEl, signal) {
    mediaEl.addEventListener('timeupdate', () => {
      currentTimeSaved = mediaEl.currentTime
    }, { signal })
    mediaEl.addEventListener('waiting', () => {
      // Questi eventi possono scattare decine di volte al secondo durante un
      // rebuffering: throttle per non sommergere il log.
      if (!rateLimited(`audio-waiting-${audioPath}`, 2000)) {
        logger.warn('evento waiting', { path: audioPath })
      }
      armStallTimer('waiting')
    }, { signal })
    mediaEl.addEventListener('stalled', () => {
      if (!rateLimited(`audio-stalled-${audioPath}`, 2000)) {
        logger.warn('evento stalled', { path: audioPath })
      }
      armStallTimer('stalled')
    }, { signal })
    mediaEl.addEventListener('playing', clearStallTimer, { signal })
    mediaEl.addEventListener('canplay', clearStallTimer, { signal })
    mediaEl.addEventListener('error', () => {
      logger.error('errore elemento audio', {
        path: audioPath,
        code: mediaEl.error?.code,
        message: mediaEl.error?.message
      })
      clearStallTimer()
      rebuild('error')
    }, { signal })
    mediaEl.addEventListener('ended', () => {
      // loop=true e l'elemento si è fermato comunque: il loop nativo si è
      // rotto (capita su alcuni stream HLS/di rete), va rifatto a mano.
      if (loop) {
        logger.warn('loop interrotto, ricostruzione', { path: audioPath })
        rebuild('ended-loop')
      }
    }, { signal })
  }

  // Stacca i listener e rilascia decoder/stream di un elemento che non serve
  // più. L'ordine NON è negoziabile: removeAttribute('src') + load() fanno
  // emettere 'error' all'elemento, che senza abort rientrerebbe in rebuild().
  function releaseElement(target, abort) {
    if (!target) return
    try { abort?.abort() } catch { /* controller già usato */ }
    try {
      target.pause()
      target.removeAttribute('src')
      target.load()
    } catch { /* elemento già morto: ignora */ }
  }

  // Parte comune di ogni fine-vita della voce (stop volontario, avvio fallito,
  // budget di ricostruzioni esaurito): niente più timer, niente più rebuild,
  // fuori dal registro delle voci vive. NON tocca fadeInterval: vedi stop().
  function releaseVoice() {
    playing = false
    destroyed = true
    clearStallTimer()
    clearTimeout(rebuildTimer)
    clearTimeout(stableTimer)
    liveStreamVoices.delete(voiceApi)
  }

  function createElement(startAt) {
    const e = new Audio()
    // NIENT'ALTRO qui: prima serviva el.crossOrigin='anonymous' perché
    // MediaElementSource su media:// (cross-origin rispetto al renderer)
    // emetteva silenzio per tainting. Senza MediaElementSource quel
    // problema — e con esso un'intera classe di fallimenti CORS silenziosi —
    // sparisce insieme al codice che lo causava.
    e.src = mediaUrl(audioPath)
    e.loop = loop
    e.preload = 'auto'
    e.volume = computeVolume()
    if (startAt > 0) e.currentTime = startAt
    elAbort = new AbortController()
    attachListeners(e, elAbort.signal)
    return e
  }

  function rebuild(reason) {
    if (destroyed) return
    if (rebuildAttempts >= MAX_REBUILD_ATTEMPTS) {
      logger.error('troppi tentativi di ricostruzione, rinuncio', { path: audioPath, attempts: rebuildAttempts, reason })
      // Rinunciare significa fine-vita: senza questo la voce resterebbe in
      // liveStreamVoices con elemento e listener vivi per tutta la sessione.
      const dead = el
      const deadAbort = elAbort
      releaseVoice()
      releaseElement(dead, deadAbort)
      notifyError({ trackId, path: audioPath, message: `Traccia audio non recuperabile dopo ${rebuildAttempts} tentativi: ${audioPath}` })
      return
    }
    clearTimeout(stableTimer) // guasto nuovo: il conto della stabilità riparte
    // Due eventi ravvicinati (es. 'error' subito dopo 'ended') schedulerebbero
    // due ricostruzioni: la seconda sovrascriverebbe `el` lasciando l'elemento
    // creato dalla prima orfano, vivo e senza nessuno che lo rilasci.
    clearTimeout(rebuildTimer)
    rebuildAttempts += 1
    const attempt = rebuildAttempts
    const resumeAt = currentTimeSaved
    // Backoff crescente (non martellare un file/rete già in difficoltà) più il
    // turno nella coda globale (non martellare un SINK già in difficoltà con
    // tutte le voci insieme).
    const backoff = reserveRebuildSlot(500 * attempt)
    logger.warn('ricostruzione voce audio', { path: audioPath, attempt, resumeAt, reason, backoffMs: backoff })
    const old = el
    const oldAbort = elAbort
    rebuildTimer = setTimeout(async () => {
      rebuildTimer = null
      if (destroyed) return
      releaseElement(old, oldAbort)
      el = createElement(resumeAt)
      try {
        await el.play()
        logger.info('ricostruzione riuscita', { path: audioPath, attempt, resumeAt })
        stableTimer = setTimeout(() => {
          if (destroyed) return
          rebuildAttempts = 0
          logger.debug('riproduzione stabile, budget ricostruzioni ripristinato', { path: audioPath })
        }, STABLE_PLAYBACK_MS)
      } catch (err) {
        logger.error('ricostruzione fallita', { path: audioPath, attempt, message: err.message })
        rebuild('retry-dopo-play-fallita')
      }
    }, backoff)
  }

  el = createElement(0)
  const voiceApi = {
    setVolume(v) {
      stopFade() // un set esplicito vince su una rampa in corso
      trackVolume = v
      outputVolume = v
      applyVolume()
    },
    // Rampa esponenziale sul volume dell'elemento: stessa curva usata per i
    // buffer (vedi commento su fadeIn/fadeOutAndStop) applicata a mano con un
    // tick, perché HTMLMediaElement.volume non ha un AudioParam da
    // automatizzare nativamente.
    //
    // Ripuntabile a costo zero: lo slider del volume emette su @input, cioè
    // decine di eventi al secondo mentre l'utente trascina. Ricreare il timer
    // ad ogni evento (com'era) voleva dire ~60 setInterval al secondo, e ogni
    // rampa che ripartiva da un valore parziale faceva ritardare il volume
    // rispetto alla manopola. Qui il timer è uno solo: cambia solo il target.
    fadeTo(v, ms, onDone) {
      // Un target non finito (volume assente su una traccia importata) si
      // propagherebbe a NaN: `el.volume = NaN` lancia, e lancia DENTRO il tick,
      // che quindi non arriva mai alla clearInterval e resta acceso per sempre.
      const target = Number.isFinite(v) ? clamp01(v) : trackVolume
      trackVolume = target // il target È il nuovo volume configurato, da subito
      fade = {
        from: outputVolume, // riparte da dove suona ORA, non dal target precedente
        target,
        tau: Math.max(ms, 1) / 4, // stesse unità (ms) di t: niente conversioni
        ms,
        startedAt: Date.now(),
        onDone
      }
      if (!fadeInterval) fadeInterval = setInterval(fadeTick, FADE_TICK_MS)
    },
    async start() {
      try {
        await el.play()
        playing = true
        logger.info('avvio traccia', { path: audioPath, kind, volume: trackVolume })
      } catch (err) {
        logger.error('avvio fallito', { path: audioPath, message: err.message })
        // Un avvio fallito è definitivo: il chiamante riceve un throw e non
        // chiamerà mai stop(). Senza questo teardown la voce resterebbe in
        // liveStreamVoices con l'elemento vivo, e l'evento 'error' che il file
        // mancante emette comunque farebbe partire il ciclo di ricostruzione
        // su una traccia già data per persa (5 tentativi, 5 elementi in più).
        releaseVoice()
        releaseElement(el, elAbort)
        notifyError({ trackId, path: audioPath, message: err.message })
        throw new Error(`Audio non trovato o non riproducibile: ${audioPath}`)
      }
    },
    stop(afterMs = 0) {
      releaseVoice() // uno stop è intenzionale: non farlo ricostruire sotto i piedi
      logger.info('stop traccia', { path: audioPath, kind })
      setTimeout(() => {
        // Il fade in corso va fermato QUI, non all'ingresso di stop():
        // fadeOutAndStop() chiama fadeTo() e subito stop(), quindi azzerare
        // l'intervallo all'ingresso ucciderebbe la rampa prima del primo tick
        // e il fade-out diventerebbe un taglio secco a volume pieno.
        stopFade()
        releaseElement(el, elAbort)
      }, afterMs + 50)
    },
    applyMaster() {
      applyVolume()
    },
    // Non fa parte dell'interfaccia Voice "pubblica": serve solo al gestore
    // di devicechange qui sotto per capire se questa voce va rimessa in play.
    resumeIfNeeded() {
      if (playing && el.paused) {
        el.play().catch((err) => logger.warn('resume dopo cambio dispositivo fallito', { path: audioPath, message: err.message }))
      }
    }
  }
  liveStreamVoices.add(voiceApi)
  return voiceApi
}

// Fade esponenziali (setTargetAtTime sui buffer, tick manuale sugli stream)
// invece di rampe lineari: con la rampa lineare la traccia entrante resta
// quasi inudibile per metà crossfade ("cambio canzone lento"); l'attacco
// esponenziale la porta al ~75% già a un terzo della durata, e il decay
// suona più naturale di un taglio lineare. Passano dall'interfaccia Voice
// comune, quindi funzionano identiche su music (stream) e one-shot (buffer).
function fadeOutAndStop(voice, durationMs) {
  voice.fadeTo(0, durationMs)
  voice.stop(durationMs)
}

function cancelPendingMusicStart() {
  if (!pendingMusicStart) return
  clearTimeout(pendingMusicStart)
  pendingMusicStart = null
}

function fadeIn(voice, targetVolume, durationMs) {
  // track.volume può mancare (traccia arrivata da un .dnds scritto a mano o da
  // un index.json più vecchio): makeStreamVoice ha un default, questo percorso
  // no, e un target NaN manderebbe il fade in un loop che lancia ad ogni tick.
  const target = Number.isFinite(targetVolume) ? targetVolume : 1
  voice.setVolume(0.0001)
  voice.fadeTo(target, durationMs)
}

// ---- Master volume ----
// Sui buffer il master è un AudioParam con rampa nativa; sugli stream è una
// moltiplicazione fatta a mano (vedi setMasterVolume), che senza rampa
// trascinando lo slider zipperava il letto musicale ma non i one-shot. La
// rampa è UNA per tutte le voci di stream: il master è uno solo.
const MASTER_RAMP_MS = 80
let masterFade = null // { from, target, tau, startedAt }
let masterInterval = null

function applyMasterToVoices() {
  for (const voice of liveStreamVoices) voice.applyMaster()
}

function stopMasterFade() {
  clearInterval(masterInterval)
  masterInterval = null
  masterFade = null
}

function masterTick() {
  if (!masterFade) return stopMasterFade()
  const t = Date.now() - masterFade.startedAt
  const value = masterFade.target + (masterFade.from - masterFade.target) * Math.exp(-t / masterFade.tau)
  masterVolume = value
  applyMasterToVoices()
  if (t > MASTER_RAMP_MS || Math.abs(value - masterFade.target) < 0.001) {
    masterVolume = masterFade.target
    stopMasterFade()
    applyMasterToVoices()
  }
}

function rampMaster(target) {
  if (!liveStreamVoices.size) {
    // Niente stream vivi: nessuna rampa da fare, il master lo applicherà
    // computeVolume() alla prima voce che parte.
    stopMasterFade()
    masterVolume = target
    return
  }
  masterFade = {
    from: masterVolume,
    target,
    tau: MASTER_RAMP_MS / 4,
    startedAt: Date.now()
  }
  if (!masterInterval) masterInterval = setInterval(masterTick, FADE_TICK_MS)
}

// ---- Stato canali ----
let musicVoice = null // { trackId, voice }
// Avvio ritardato del ramo 'fade' di playMusic: va tenuto per poterlo
// ANNULLARE. Senza, uno stopMusic/stopAll dentro la finestra di fade non
// trovava ancora nessuna voce da fermare, e il timer faceva poi partire una
// traccia che la UI dava per spenta — orfana, e con la recovery attiva ormai
// capace di sopravvivere a se stessa per tutta la sessione.
let pendingMusicStart = null
const ambienceVoices = new Map() // trackId -> voice

// Chromium può lasciare gli elementi in pausa (o muti) dopo uno switch di
// sink audio (es. profilo A2DP/HSP del Bluetooth): senza questo la musica
// resta silenziosa finché non si tocca manualmente un bottone.
navigator.mediaDevices?.addEventListener('devicechange', () => {
  logger.info('cambio dispositivo audio rilevato')
  for (const voice of liveStreamVoices) voice.resumeIfNeeded()
})

// Il motore qui non sospende mai il context di proposito (nessuna API
// pubblica chiama ctx.suspend()): quindi se lo stato esce da "running" è
// sempre un evento esterno (policy del browser, perdita del device) e va
// ripreso subito, altrimenti anche i one-shot restano muti.
ctx.onstatechange = () => {
  logger.info('stato AudioContext cambiato', { state: ctx.state })
  if (ctx.state !== 'running') {
    ctx.resume().catch((err) => logger.warn('resume AudioContext fallito', { message: err.message }))
  }
}

export const engine = {
  resume: () => ctx.resume(),

  setErrorHandler(fn) {
    errorHandler = fn
  },

  // Due percorsi distinti e voluti: gli stream (music/ambience) non passano
  // più per masterGain, quindi il master va riapplicato a mano su ognuno;
  // il one-shot resta sul nodo condiviso con la sua rampa nativa. Il
  // vantaggio collaterale: se l'AudioContext si inceppa, si perdono solo i
  // one-shot, non il letto musicale.
  setMasterVolume(v) {
    const target = Number.isFinite(v) ? v : 1
    masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.02) // one-shot: rampa nativa
    rampMaster(target) // stream: stessa rampa, fatta a mano
  },

  setTrackVolume(trackId, v) {
    // Rampa breve (80ms ~ vecchio tau*4) invece di un salto secco: evita lo
    // zipper noise quando l'utente trascina lo slider del volume. Chiamarla ad
    // ogni evento @input non costa timer: fadeTo ripunta la rampa esistente.
    if (musicVoice?.trackId === trackId) musicVoice.voice.fadeTo(v, 80)
    const amb = ambienceVoices.get(trackId)
    if (amb) amb.fadeTo(v, 80)
  },

  // ---- Music: canale esclusivo con transizioni ----
  async playMusic(track, { transition = 'crossfade', duration = 3000 } = {}) {
    await ctx.resume()
    cancelPendingMusicStart() // una nuova traccia annulla quella ancora in attesa
    const fading = transition === 'crossfade' || transition === 'fade'

    const startNew = async () => {
      // Parte quasi muto se in fade: il volume lo porta su fadeIn
      const voice = makeStreamVoice(track.audioPath, {
        loop: true,
        volume: fading ? 0.0001 : track.volume,
        trackId: track.id,
        kind: 'music'
      })
      await voice.start()
      if (fading) fadeIn(voice, track.volume, duration)
      musicVoice = { trackId: track.id, voice }
    }

    const old = musicVoice
    musicVoice = null

    if (!old) {
      await startNew()
    } else if (transition === 'instant') {
      old.voice.stop()
      await startNew()
    } else if (transition === 'crossfade') {
      fadeOutAndStop(old.voice, duration)
      await startNew()
    } else {
      // fade: prima out, poi in
      fadeOutAndStop(old.voice, duration)
      pendingMusicStart = setTimeout(() => {
        pendingMusicStart = null
        startNew().catch(() => {})
      }, duration)
    }
  },

  stopMusic({ duration = 1000 } = {}) {
    // Prima di tutto: se c'è un avvio in attesa (ramo 'fade'), fermarlo. La
    // voce non esiste ancora, quindi il controllo su musicVoice qui sotto la
    // lascerebbe partire dopo lo stop.
    cancelPendingMusicStart()
    if (!musicVoice) return
    fadeOutAndStop(musicVoice.voice, duration)
    musicVoice = null
  },

  get activeMusicId() {
    return musicVoice?.trackId ?? null
  },

  // ---- Ambience: additivo, illimitato ----
  async playAmbience(track) {
    await ctx.resume()
    if (ambienceVoices.has(track.id)) return
    const voice = makeStreamVoice(track.audioPath, {
      loop: true,
      volume: 0.0001,
      trackId: track.id,
      kind: 'ambience'
    })
    await voice.start()
    fadeIn(voice, track.volume, 500)
    ambienceVoices.set(track.id, voice)
  },

  stopAmbience(trackId) {
    const voice = ambienceVoices.get(trackId)
    if (!voice) return
    fadeOutAndStop(voice, 500)
    ambienceVoices.delete(trackId)
  },

  isAmbienceActive(trackId) {
    return ambienceVoices.has(trackId)
  },

  get activeAmbienceIds() {
    return [...ambienceVoices.keys()]
  },

  // ---- One-Shot: fire and forget ----
  async playOneShot(track) {
    await ctx.resume()
    const buffer = await loadBuffer(track.audioPath)
    const voice = makeBufferVoice(buffer, { loop: false, volume: track.volume })
    voice.start()
  },

  // ---- Stop All ----
  stopAll() {
    this.stopMusic({ duration: 300 })
    for (const id of [...ambienceVoices.keys()]) this.stopAmbience(id)
  }
}
