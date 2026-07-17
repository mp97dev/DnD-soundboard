// Auto-update del binario yt-dlp. YouTube cambia spesso lato server e le
// versioni vecchie smettono di funzionare (errori tipo "Unable to extract...").
// Strategia: al primo comando fallito si prova `yt-dlp -U` e si ritenta una
// volta. Il binario bundled può stare in una directory non scrivibile
// (resources di Electron, AppImage): in quel caso lo copiamo in writableDir
// e da lì in poi usiamo/aggiorniamo la copia.
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

// Al massimo un tentativo di update all'ora: se fallisce (rete giù, ecc.)
// non vogliamo riprovare a ogni singolo download.
const UPDATE_COOLDOWN_MS = 60 * 60 * 1000
let lastAttempt = 0

function canWrite(file) {
  try {
    fs.accessSync(file, fs.constants.W_OK)
    fs.accessSync(path.dirname(file), fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

// Sceglie tra il binario bundled e l'eventuale copia auto-aggiornata in
// writableDir: vince la più recente (l'update riscrive il file → mtime nuovo).
function preferredBin(bundled, writableDir) {
  if (!writableDir) return bundled
  const copy = path.join(writableDir, path.basename(bundled))
  if (!fs.existsSync(copy)) return bundled
  if (!path.isAbsolute(bundled) || !fs.existsSync(bundled)) return copy
  return fs.statSync(copy).mtimeMs >= fs.statSync(bundled).mtimeMs ? copy : bundled
}

// Prova ad aggiornare il binario. Ritorna il path aggiornato, oppure null se
// l'update non è possibile (binario di sistema nel PATH, cooldown attivo).
// Lancia se `yt-dlp -U` fallisce.
async function maybeUpdate({ current, writableDir, env } = {}) {
  const now = Date.now()
  if (now - lastAttempt < UPDATE_COOLDOWN_MS) return null
  lastAttempt = now

  // Binario di sistema nel PATH (es. apt): l'aggiornamento spetta al package
  // manager, non a noi.
  if (!path.isAbsolute(current)) return null

  let target = current
  if (!canWrite(current)) {
    if (!writableDir) return null
    fs.mkdirSync(writableDir, { recursive: true })
    target = path.join(writableDir, path.basename(current))
    await fs.promises.copyFile(current, target)
    if (process.platform !== 'win32') fs.chmodSync(target, 0o755)
  }

  await new Promise((resolve, reject) => {
    const proc = spawn(target, ['-U'], { windowsHide: true, env })
    let err = ''
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(err || `yt-dlp -U exit ${code}`))
    )
  })
  return target
}

// yt-dlp scrive stderr molto verboso: per la UI teniamo solo l'ultima riga
// "ERROR: ..." (o l'ultima riga utile), troncata.
function friendlyError(err) {
  const lines = String(err?.message || err || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  const line =
    [...lines].reverse().find((l) => /^ERROR/i.test(l)) ||
    lines[lines.length - 1] ||
    'yt-dlp: errore sconosciuto'
  return new Error(line.length > 300 ? `${line.slice(0, 300)}…` : line)
}

module.exports = { preferredBin, maybeUpdate, friendlyError }
