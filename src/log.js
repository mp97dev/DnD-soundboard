// Logger lato renderer: rispecchia in console e inoltra al processo host
// (Electron main o server Node) via window.api.log, che scrive su file.
// Mai bloccante e mai fatale: un log non deve poter rompere l'UI.

function serializeFields(fields) {
  if (!fields || typeof fields !== 'object') return fields
  // Error non sopravvive al confine IPC/JSON (structured clone la mangia o
  // la rifiuta): la riduciamo al messaggio prima di spedirla.
  const out = {}
  for (const key of Object.keys(fields)) {
    const v = fields[key]
    out[key] = v instanceof Error ? v.message : v
  }
  return out
}

function send(level, scope, msg, fields) {
  try {
    // Il try/catch prende solo i throw sincroni (es. un campo che non passa lo
    // structured clone del contextBridge). In Electron write() è un
    // ipcRenderer.invoke, quindi una promise: senza .catch() un handler assente
    // o in errore diventa una unhandled rejection, contro il "mai fatale" qui sopra.
    Promise.resolve(
      window.api?.log?.write({ level, scope, msg, fields: serializeFields(fields) })
    ).catch(() => {})
  } catch { /* mai propagare: il logging non deve rompere il chiamante */ }
}

function consoleMirror(level, scope, msg, fields) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  try {
    if (fields !== undefined) fn(`[${scope}] ${msg}`, fields)
    else fn(`[${scope}] ${msg}`)
  } catch { /* console rotta: ignora */ }
}

function write(level, scope, msg, fields) {
  consoleMirror(level, scope, msg, fields)
  send(level, scope, msg, fields)
}

export const log = {
  debug: (scope, msg, fields) => write('debug', scope, msg, fields),
  info: (scope, msg, fields) => write('info', scope, msg, fields),
  warn: (scope, msg, fields) => write('warn', scope, msg, fields),
  error: (scope, msg, fields) => write('error', scope, msg, fields)
}

export function child(scope) {
  return {
    debug: (msg, fields) => log.debug(scope, msg, fields),
    info: (msg, fields) => log.info(scope, msg, fields),
    warn: (msg, fields) => log.warn(scope, msg, fields),
    error: (msg, fields) => log.error(scope, msg, fields)
  }
}

// Eventi come 'stalled'/'waiting' del media possono scattare decine di volte
// al secondo: senza throttle sommergono il log. true se `key` è già stata
// loggata negli ultimi `ms`.
const lastLogged = new Map()
export function rateLimited(key, ms) {
  const now = Date.now()
  const last = lastLogged.get(key)
  if (last !== undefined && now - last < ms) return true
  lastLogged.set(key, now)
  return false
}
