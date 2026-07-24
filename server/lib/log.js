// Logger condiviso da Electron main e dal server Node standalone.
// Nessuna dipendenza esterna: un log rotto non deve mai propagare un errore
// a chi chiama (playback/cast non devono spezzarsi per colpa del logging).
const fs = require('fs')
const path = require('path')

const LEVEL_LABEL = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR' }
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2 MB, poi ruota in .1
const FILE_RETRY_DELAY_MS = 30000 // dopo un errore di scrittura, non ritentare per 30s
const MAX_PRE_INIT_BUFFER = 200

let logDir = null
let logFile = null
let fd = null
let currentSize = 0
let fileDisabledUntil = 0

// Righe scritte prima di init(): niente file ancora, teniamo un buffer
// limitato da flushare non appena il logger viene inizializzato.
let preInitBuffer = []

function formatValue(v) {
  if (v instanceof Error) return v.message
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

function rotateIfNeeded() {
  if (currentSize <= MAX_FILE_SIZE) return
  // Un solo backup: rinomina sovrascrive l'eventuale .1 precedente
  try {
    fs.closeSync(fd)
  } catch { /* ignora: il fd potrebbe già essere invalido */ }
  fs.renameSync(logFile, `${logFile}.1`)
  fd = fs.openSync(logFile, 'a')
  currentSize = 0
}

// Scrive una riga già formattata (con \n finale) sul file corrente.
// Qualunque fallimento qui NON deve uscire da questa funzione: disabilita
// il file per un po' e lascia che il chiamante prosegua indisturbato.
function writeToFile(line) {
  const now = Date.now()
  if (fd === null) {
    if (now < fileDisabledUntil) return
    try {
      fd = fs.openSync(logFile, 'a')
      currentSize = fs.fstatSync(fd).size
    } catch {
      fileDisabledUntil = Date.now() + FILE_RETRY_DELAY_MS
      return
    }
  }
  try {
    rotateIfNeeded()
    fs.writeSync(fd, line)
    currentSize += Buffer.byteLength(line)
  } catch {
    try {
      fs.closeSync(fd)
    } catch { /* già invalido */ }
    fd = null
    fileDisabledUntil = Date.now() + FILE_RETRY_DELAY_MS
  }
}

function writeEntry(level, scope, msg, fields) {
  const line = `${new Date().toISOString()} ${LEVEL_LABEL[level].padEnd(5)} ${scope} ${msg}${formatFields(fields)}`

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
  writeToFile(fileLine)
}

function init(dataDir) {
  logDir = path.join(dataDir, 'logs')
  logFile = path.join(logDir, 'soundboard.log')
  try {
    fs.mkdirSync(logDir, { recursive: true })
    fd = fs.openSync(logFile, 'a')
    currentSize = fs.fstatSync(fd).size
  } catch {
    fd = null
    fileDisabledUntil = Date.now() + FILE_RETRY_DELAY_MS
  }

  if (preInitBuffer.length) {
    const pending = preInitBuffer
    preInitBuffer = []
    for (const line of pending) writeToFile(line)
  }
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

function child(scope) {
  return {
    debug: (msg, fields) => debug(scope, msg, fields),
    info: (msg, fields) => info(scope, msg, fields),
    warn: (msg, fields) => warn(scope, msg, fields),
    error: (msg, fields) => error(scope, msg, fields)
  }
}

function logPath() {
  return logFile
}

module.exports = { init, debug, info, warn, error, child, logPath }
