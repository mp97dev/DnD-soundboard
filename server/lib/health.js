// Battito di salute del processo host (main di Electron o server LAN).
// Gemello di src/health.js, che fa lo stesso per il renderer: là si guarda
// se l'audio suona ancora, qui se il processo che serve i byte — audio via
// media://, media HTTP per la TV, log su disco — sta crescendo o rallentando.
//
// Perché serva: in una sessione di 4 ore nessuno guarda il Task Manager, e i
// due sospetti classici (RSS che sale piano fino allo swap, event loop che
// ritarda perché qualcuno blocca) non emettono nessun evento. Sono misurabili
// solo campionandoli.
const log = require('./log')
const cast = require('./cast')

const DEFAULT_INTERVAL_MS = 60000

// Ritardo dell'event loop: si programma un timer a 0 ms e si guarda quanto
// tardi scatta davvero. Sopra le decine di ms significa che qualcosa sta
// bloccando il loop — cioè lo stesso loop che pompa i byte audio.
function measureLoopDelay() {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint()
    setTimeout(() => resolve(Number(process.hrtime.bigint() - t0) / 1e6), 0)
  })
}

function startHealthHeartbeat({ intervalMs = DEFAULT_INTERVAL_MS, host = 'host' } = {}) {
  const hlog = log.child('health')
  const startedAt = Date.now()

  const beat = async () => {
    try {
      const mem = process.memoryUsage()
      const st = cast.status()
      hlog.info('battito host', {
        host,
        uptimeMin: Math.round((Date.now() - startedAt) / 60000),
        rssMB: Math.round(mem.rss / 1048576),
        heapMB: Math.round(mem.heapUsed / 1048576),
        externalMB: Math.round(mem.external / 1048576),
        loopDelayMs: Math.round(await measureLoopDelay()),
        cast: st.casting,
        castUptimeSec: st.uptimeSec,
        castRiconnessione: st.reconnecting
      })
    } catch (err) {
      // Misurare non deve poter rompere quello che si sta misurando.
      hlog.warn('battito host fallito', { message: err.message })
    }
  }

  beat()
  const timer = setInterval(beat, intervalMs)
  // unref: il battito non deve tenere vivo il processo da solo.
  timer.unref?.()
  return () => clearInterval(timer)
}

module.exports = { startHealthHeartbeat }
