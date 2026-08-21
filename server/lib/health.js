// Battito di salute del processo host (main di Electron o server LAN).
// Gemello di src/health.js, che fa lo stesso per il renderer: là si guarda
// se l'audio suona ancora, qui se il processo che serve i byte — audio via
// media://, media HTTP per la TV, log su disco — sta crescendo o rallentando.
//
// Perché serva: in una sessione di 4 ore nessuno guarda il Task Manager, e i
// due sospetti classici (RSS che sale piano fino allo swap, event loop che
// ritarda perché qualcuno blocca) non emettono nessun evento. Sono misurabili
// solo campionandoli.
const os = require('os')
const log = require('./log')
const cast = require('./cast')
const { probeAudioSink } = require('./diagnostics')

const DEFAULT_INTERVAL_MS = 60000

// Carico medio a 1 minuto diviso per il numero di CPU logiche. Sopra 1 la
// macchina ha più lavoro pronto di quanto sappia eseguirne, e i thread che
// hanno una scadenza — quello che codifica l'audio verso la cassa Bluetooth —
// cominciano a mancarla. Su un due core del 2012, con un browser pieno di
// schede accanto, è LA misura che dice se la colpa è dell'app o della macchina.
// Su Windows loadavg() torna sempre [0,0,0]: meglio null che uno zero finto.
function loadPerCpu() {
  if (process.platform === 'win32') return null
  const cpus = os.cpus().length || 1
  return Math.round((os.loadavg()[0] / cpus) * 100) / 100
}

// Ritardo dell'event loop: si programma un timer a 0 ms e si guarda quanto
// tardi scatta davvero. Sopra le decine di ms significa che qualcosa sta
// bloccando il loop — cioè lo stesso loop che pompa i byte audio.
function measureLoopDelay() {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint()
    setTimeout(() => resolve(Number(process.hrtime.bigint() - t0) / 1e6), 0)
  })
}

// Le voci dell'uscita audio che, cambiando, spiegano un peggioramento: la
// cassa su cui si suona e il profilo Bluetooth. Il resto (nome del server
// audio) non cambia mai in sessione e sporcherebbe il confronto.
const WATCHED = ['defaultSink', 'profiloBluetooth']

function describeChange(before, after) {
  const changed = WATCHED.filter((k) => before[k] !== after[k] && (before[k] ?? after[k]) !== undefined)
  if (!changed.length) return null
  return Object.fromEntries(changed.flatMap((k) => [[`${k}Prima`, before[k] ?? '—'], [`${k}Dopo`, after[k] ?? '—']]))
}

function startHealthHeartbeat({ intervalMs = DEFAULT_INTERVAL_MS, host = 'host' } = {}) {
  const hlog = log.child('health')
  const startedAt = Date.now()
  // L'uscita audio va ricampionata a ogni battito, non solo all'avvio: il
  // guasto che interessa succede A SESSIONE IN CORSO. La cassa Bluetooth che
  // scivola da A2DP a HSP perché una scheda del browser ha aperto il microfono
  // non manda nessun evento — la musica si impasta e basta, e senza una riga
  // col suo orario non c'è modo di collegare le due cose dopo.
  let lastSink = null
  // process.cpuUsage() è cumulativo dall'avvio: la percentuale di questo
  // minuto è la differenza fra due battiti, non il totale.
  let lastCpu = process.cpuUsage()
  let lastCpuAt = Date.now()

  const beat = async () => {
    try {
      const mem = process.memoryUsage()
      const st = cast.status()
      const cpu = process.cpuUsage()
      const now = Date.now()
      const elapsedUs = Math.max(1, (now - lastCpuAt) * 1000)
      const cpuPct = Math.round(((cpu.user - lastCpu.user + cpu.system - lastCpu.system) / elapsedUs) * 100)
      lastCpu = cpu
      lastCpuAt = now

      hlog.info('battito host', {
        host,
        uptimeMin: Math.round((Date.now() - startedAt) / 60000),
        rssMB: Math.round(mem.rss / 1048576),
        heapMB: Math.round(mem.heapUsed / 1048576),
        externalMB: Math.round(mem.external / 1048576),
        loopDelayMs: Math.round(await measureLoopDelay()),
        // Il processo contro la macchina: cpuPct alto con caricoPerCpu basso
        // è colpa nostra, il contrario è la macchina che sta annegando per
        // conto suo (il browser accanto, un aggiornamento, l'antivirus).
        cpuPct,
        caricoPerCpu: loadPerCpu(),
        ramLiberaMB: Math.round(os.freemem() / 1048576),
        cast: st.casting,
        castUptimeSec: st.uptimeSec,
        castRiconnessione: st.reconnecting
      })

      // Regola di rumore, come nel battito del renderer: quando non cambia
      // niente non si scrive niente. La riga esce solo quando c'è da dire
      // qualcosa, ed è lì che serve.
      const sink = await probeAudioSink()
      if (lastSink) {
        const change = describeChange(lastSink, sink)
        if (change) {
          hlog.warn('uscita audio cambiata', {
            ...change,
            // Scendere da A2DP a HSP/HFP è il caso brutto: da stereo 44.1 kHz a
            // mono 8-16 kHz. Va detto a parole, non lasciato dedurre dai nomi.
            perditaDiQualita: lastSink.altaFedelta === true && sink.altaFedelta === false
          })
        }
      }
      lastSink = sink
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
