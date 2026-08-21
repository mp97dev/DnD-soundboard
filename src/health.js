// Battito di salute del renderer: una riga al minuto nel log.
//
// Una sessione di gioco dura ore e i guasti che ci interessano (audio che
// ammutolisce, memoria che cresce, AudioContext che esce da 'running') non
// emettono nessun evento: si notano solo confrontando due istanti lontani. Una
// riga periodica trasforma qualunque sessione — vera o soak — in una serie
// temporale che scripts/session-report.js sa leggere.
//
// Regola di rumore: quando va tutto bene è UNA riga info; quando qualcosa non
// torna diventa un warn con il dettaglio delle voci, perché è l'unico momento
// in cui i dettagli servono davvero.
import { engine } from './audio/engine'
import { child } from './log'

const logger = child('health')
const DEFAULT_INTERVAL_MS = 60000

function heapMB() {
  // performance.memory esiste solo su Chromium (cioè sempre, qui: Electron o
  // browser del tablet), ma non è nello standard: mai darlo per scontato.
  const used = performance?.memory?.usedJSHeapSize
  return used ? Math.round(used / 1048576) : null
}

// Una voce è "muta" se si crede in riproduzione ma l'elemento è fermo, oppure
// se il tempo non è avanzato rispetto al battito precedente. Il secondo caso è
// quello che nessun evento segnala: l'elemento resta 'playing' e non suona.
function mutedVoices(voices, previous) {
  return voices.filter((v) => {
    if (v.state !== 'playing') return false
    if (v.paused) return true
    const before = previous.get(v.trackId)?.currentTime
    return before !== undefined && v.currentTime === before
  })
}

// I contatori dell'engine sono cumulativi: quello che dice se la sessione sta
// peggiorando è quanti ne sono arrivati IN QUESTO MINUTO. Le voci nate dopo
// l'ultimo battito non hanno un precedente e contano per intero.
function sinceLast(voices, previous, key) {
  return voices.reduce((n, v) => n + (v[key] ?? 0) - (previous.get(v.trackId)?.[key] ?? 0), 0)
}

export function startHealthHeartbeat({ intervalMs = DEFAULT_INTERVAL_MS, extra = () => ({}) } = {}) {
  const startedAt = Date.now()
  let previous = new Map()

  const beat = () => {
    try {
      const { ctxState, sampleRate, voices } = engine.health
      const muted = mutedVoices(voices, previous)
      const buchi = sinceLast(voices, previous, 'waiting') + sinceLast(voices, previous, 'stalled')
      previous = new Map(voices.map((v) => [v.trackId, v]))

      // Il margine più sottile fra tutte le voci vive: se una sola sta per
      // restare a secco, è quella che si sentirà scattare.
      const margini = voices.map((v) => v.bufferedAheadSec).filter((s) => typeof s === 'number')

      const fields = {
        uptimeMin: Math.round((Date.now() - startedAt) / 60000),
        heapMB: heapMB(),
        ctxState,
        sampleRate,
        voices: voices.length,
        rebuilds: voices.reduce((n, v) => n + v.rebuilds, 0),
        // Quante volte l'audio è rimasto senza dati dall'ultimo battito. Zero
        // per tutta la sessione = la macchina sta al passo; qualche decina in
        // un minuto = è lì che è andata storta, con l'orario accanto.
        buchi,
        bufferMinSec: margini.length ? Math.min(...margini) : null,
        // La scheda in secondo piano cambia le regole del browser (timer
        // rallentati, priorità più bassa): va saputo prima di dare la colpa
        // all'app. 'hidden' accanto a dei buchi è mezza risposta.
        scheda: typeof document !== 'undefined' ? document.visibilityState : null,
        ...extra()
      }

      // Un minuto con dei buchi entra fra le righe da guardare anche se
      // nessuna voce è morta: è il sintomo che l'utente sente, e senza questo
      // resterebbe un numero in mezzo a una riga info come tutte le altre.
      if (muted.length || buchi || ctxState !== 'running') {
        logger.warn('battito: audio non in salute', {
          ...fields,
          muti: muted.length,
          dettaglio: JSON.stringify(muted)
        })
      } else {
        logger.info('battito', fields)
      }
    } catch (err) {
      // Il battito non deve mai poter rompere la sessione che sta misurando.
      logger.warn('battito fallito', { message: err.message })
    }
  }

  // Di che macchina stiamo parlando, una volta sola. Su un portatile a due
  // core del 2012 con dieci schede aperte accanto, la risposta a «perché
  // scatta» può essere semplicemente questa riga.
  logger.info('ambiente renderer', {
    cpuLogiche: navigator.hardwareConcurrency ?? null,
    ramGB: navigator.deviceMemory ?? null, // solo Chromium, e arrotondato in giù
    userAgent: navigator.userAgent
  })

  beat() // una riga di partenza subito: dà il livello base da confrontare
  const timer = setInterval(beat, intervalMs)
  return () => clearInterval(timer)
}
