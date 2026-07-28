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
    const before = previous.get(v.trackId)
    return before !== undefined && v.currentTime === before
  })
}

export function startHealthHeartbeat({ intervalMs = DEFAULT_INTERVAL_MS, extra = () => ({}) } = {}) {
  const startedAt = Date.now()
  let previous = new Map()

  const beat = () => {
    try {
      const { ctxState, sampleRate, voices } = engine.health
      const muted = mutedVoices(voices, previous)
      previous = new Map(voices.map((v) => [v.trackId, v.currentTime]))

      const fields = {
        uptimeMin: Math.round((Date.now() - startedAt) / 60000),
        heapMB: heapMB(),
        ctxState,
        sampleRate,
        voices: voices.length,
        rebuilds: voices.reduce((n, v) => n + v.rebuilds, 0),
        ...extra()
      }

      if (muted.length || ctxState !== 'running') {
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

  beat() // una riga di partenza subito: dà il livello base da confrontare
  const timer = setInterval(beat, intervalMs)
  return () => clearInterval(timer)
}
