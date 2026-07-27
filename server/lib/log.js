// Logger condiviso da Electron main e dal server Node standalone.
// Nessuna dipendenza esterna: un log rotto non deve mai propagare un errore
// a chi chiama (playback/cast non devono spezzarsi per colpa del logging).
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

const LEVEL_LABEL = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' }
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2 MB, poi ruota in .1
const FILE_RETRY_DELAY_MS = 30000 // dopo un errore di scrittura, non ritentare per 30s
const MAX_PRE_INIT_BUFFER = 200
// Tetto alla coda in attesa di flush: se il disco è fermo, perdere righe è
// meglio che gonfiare la RAM del processo che deve continuare a suonare.
const MAX_QUEUED_LINES = 5000

let logDir = null
let logFile = null
let handle = null
let currentSize = 0
let fileDisabledUntil = 0

// Righe scritte prima di init(): niente file ancora, teniamo un buffer
// limitato da flushare non appena il logger viene inizializzato.
let preInitBuffer = []

// Coda di scrittura. Il logger gira nel MAIN process di Electron, lo stesso
// event loop che pompa i byte audio verso il renderer (protocol.handle
// 'media' -> fs.createReadStream): una fs.writeSync per riga bloccava quel
// loop ad ogni log, e la raffica peggiore arriva proprio durante un guasto
// audio (waiting/stalled/rebuild di ogni voce viva). Cioè la strumentazione
// che deve spiegare i buchi audio era in grado di causarli. Qui le righe
// vengono accodate e scritte in asincrono, raggruppate in un colpo solo.
let queue = []
let flushing = false
let flushScheduled = false
let exitHookInstalled = false

// Una riga = una entry: il formato è pensato per essere letto a grep (vedi
// docs/session-test-plan.md §6). Newline e altri caratteri di controllo
// spezzerebbero un'entry in più righe — e siccome /api/log non è autenticato
// sulla LAN, permetterebbero anche di forgiarne di finte.
function oneLine(s) {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)
    out += code < 32 || code === 127 ? ' ' : ch
  }
  return out
}

function formatValue(v) {
  // Il messaggio di un Error passa dal ramo stringa (quindi viene quotato se
  // contiene spazi o newline): senza, uno stack multi-riga rompeva la riga.
  if (v instanceof Error) return formatValue(v.message)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') {
    // Quoting solo se serve: spazi/=/virgolette romperebbero il parsing key=value
    return /[\s="]/.test(v) ? JSON.stringify(v) : v
  }
  // Tipo imprevisto (oggetto/array): meglio stringificarlo che perdere l'informazione
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function formatFields(fields) {
  if (!fields || typeof fields !== 'object') return ''
  const parts = []
  for (const key of Object.keys(fields)) {
    const v = fields[key]
    if (v === null || v === undefined) continue // campi vuoti: omessi, non "null"/"undefined" in chiaro
    parts.push(`${key}=${formatValue(v)}`)
  }
  return parts.length ? ' ' + parts.join(' ') : ''
}

async function closeHandle() {
  // L'handle va azzerato SUBITO: se la chiusura fallisce a metà, il resto del
  // codice non deve poter riprovare a scriverci sopra.
  const h = handle
  handle = null
  if (!h) return
  try {
    await h.close()
  } catch { /* ignora: l'handle potrebbe già essere invalido */ }
}

async function rotateIfNeeded() {
  if (currentSize <= MAX_FILE_SIZE) return
  // Un solo backup: rinomina sovrascrive l'eventuale .1 precedente.
  await closeHandle()
  currentSize = 0
  // Se rename o open lanciano, handle resta null: ci pensa il catch di
  // writeChunk a mettere il file in pausa per FILE_RETRY_DELAY_MS.
  await fsp.rename(logFile, `${logFile}.1`)
  handle = await fsp.open(logFile, 'a')
}

// Scrive un blocco di righe già formattate sul file corrente.
// Qualunque fallimento qui NON deve uscire da questa funzione: disabilita
// il file per un po' e lascia che il chiamante prosegua indisturbato.
async function writeChunk(chunk) {
  if (handle === null) {
    if (Date.now() < fileDisabledUntil) return
    try {
      handle = await fsp.open(logFile, 'a')
      currentSize = (await handle.stat()).size
    } catch {
      handle = null
      fileDisabledUntil = Date.now() + FILE_RETRY_DELAY_MS
      return
    }
  }
  try {
    await rotateIfNeeded()
    await handle.write(chunk)
    currentSize += Buffer.byteLength(chunk)
  } catch {
    await closeHandle()
    fileDisabledUntil = Date.now() + FILE_RETRY_DELAY_MS
  }
}

// Un solo flush per volta: le scritture devono restare in ordine, e due
// rotateIfNeeded() concorrenti si rinominerebbero il file sotto i piedi.
async function flush() {
  flushScheduled = false
  if (flushing || !logFile) return
  flushing = true
  try {
    while (queue.length) {
      const chunk = queue.join('')
      queue = []
      await writeChunk(chunk)
    }
  } finally {
    flushing = false
  }
}

function scheduleFlush() {
  if (flushScheduled || !logFile) return
  flushScheduled = true
  // setImmediate e non un timer: le righe finiscono su disco alla fine del
  // giro corrente di event loop, non al prossimo tick del timer più vicino.
  setImmediate(flush)
}

let dropped = 0
function enqueue(line) {
  if (queue.length >= MAX_QUEUED_LINES) {
    // Un buco nel log va DETTO: un file che salta da un istante all'altro
    // senza spiegazioni è peggio di un file che dichiara cosa ha perso.
    dropped += 1
    return
  }
  if (dropped > 0) {
    queue.push(`${new Date().toISOString()} WARN  log coda piena, righe perse dropped=${dropped}\n`)
    dropped = 0
  }
  queue.push(line)
  scheduleFlush()
}

// Ultima spiaggia: alla chiusura del processo l'event loop non gira più, quindi
// quello che è ancora in coda va scritto in sincrono o si perde. È l'UNICO
// punto in cui il logger blocca — qui non c'è più audio da mandare a nessuno.
function flushSync() {
  if (!logFile || !queue.length) return
  const chunk = queue.join('')
  queue = []
  try {
    fs.appendFileSync(logFile, chunk)
  } catch { /* il file non è disponibile: le righe sono comunque già su console */ }
}

function writeEntry(level, scope, msg, fields) {
  // scope e msg finiscono nella riga senza quoting (a differenza dei campi,
  // che passano da formatValue): vanno ripuliti qui o una newline dentro un
  // err.message spezza l'entry in due righe.
  const line = `${new Date().toISOString()} ${LEVEL_LABEL[level].padEnd(5)} ${oneLine(String(scope))} ${oneLine(String(msg))}${formatFields(fields)}`

  // La console riceve sempre la riga, init o meno: è la rete di sicurezza
  // se il file non è (ancora, o più) disponibile.
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  try {
    consoleFn(line)
  } catch { /* console rotta: non c'è altro da fare */ }

  const fileLine = line + '\n'
  if (!logFile) {
    // Pre-init: bufferizza (limitato) così le righe di avvio non si perdono
    if (preInitBuffer.length < MAX_PRE_INIT_BUFFER) preInitBuffer.push(fileLine)
    return
  }
  enqueue(fileLine)
}

function init(dataDir) {
  logDir = path.join(dataDir, 'logs')
  logFile = path.join(logDir, 'soundboard.log')
  // La sola operazione sincrona rimasta, una volta sola all'avvio: senza la
  // directory non c'è niente da aprire. Il file lo apre il primo flush.
  try {
    fs.mkdirSync(logDir, { recursive: true })
  } catch {
    fileDisabledUntil = Date.now() + FILE_RETRY_DELAY_MS
  }

  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.on('exit', flushSync)
  }

  if (preInitBuffer.length) {
    queue = preInitBuffer.concat(queue).slice(0, MAX_QUEUED_LINES)
    preInitBuffer = []
  }
  scheduleFlush()
}

function debug(scope, msg, fields) {
  writeEntry('debug', scope, msg, fields)
}
function info(scope, msg, fields) {
  writeEntry('info', scope, msg, fields)
}
function warn(scope, msg, fields) {
  writeEntry('warn', scope, msg, fields)
}
function error(scope, msg, fields) {
  writeEntry('error', scope, msg, fields)
}

// Ingresso unico per le righe che arrivano dal renderer, sia via IPC Electron
// ('log:write') sia via POST /api/log del server LAN: stesse regole di
// normalizzazione in un posto solo. Non lancia MAI — il logging non deve
// poter rompere né la UI né una richiesta HTTP.
const CLIENT_LEVELS = ['debug', 'info', 'warn', 'error']
function fromClient(entry) {
  try {
    const { level, scope, msg, fields } = entry || {}
    const lvl = CLIENT_LEVELS.includes(level) ? level : 'info'
    // Prefisso ui: per distinguere a colpo d'occhio le righe del renderer da
    // quelle del processo host
    const scopedName = `ui:${String(scope ?? '').slice(0, 200)}`
    const text = String(msg ?? '').slice(0, 500)
    const safeFields =
      fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : undefined
    writeEntry(lvl, scopedName, text, safeFields)
  } catch { /* input irrecuperabile: si perde la riga, mai un errore al chiamante */ }
}

function child(scope) {
  return {
    debug: (msg, fields) => debug(scope, msg, fields),
    info: (msg, fields) => info(scope, msg, fields),
    warn: (msg, fields) => warn(scope, msg, fields),
    error: (msg, fields) => error(scope, msg, fields)
  }
}

module.exports = { init, debug, info, warn, error, child, fromClient, flushSync }
