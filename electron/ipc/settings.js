const { ipcMain } = require('electron')
const fs = require('fs')
const { SETTINGS_FILE } = require('../paths')

const DEFAULTS = {
  version: 1,
  masterVolume: 0.8,
  musicTransition: 'crossfade',
  transitionDuration: 3000,
  castDeviceHost: null,
  castDeviceName: null,
  // Tema attivo ('candela' | 'notturno' | 'giorno' | 'custom') e, solo per
  // 'custom', i sette colori scelti dall'utente. Scritti dal renderer.
  // null = mai scelto, ed è l'unico modo per dirlo: con un default 'candela' il
  // file non può distinguere "primo avvio" da "l'utente ha scelto candela".
  theme: null,
  customTheme: null,
  // Ultima cartella usata nei dialog di import, tenute separate perché audio e
  // visual di solito stanno in posti diversi. Scritte solo dal main process.
  lastImportDirAudio: null,
  lastImportDirVisual: null
}

function readSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

// patch parziale: quello che non passa resta com'è su disco
function writeSettings(patch) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readSettings(), ...patch }, null, 2))
}

function registerSettingsIpc() {
  ipcMain.handle('settings:get', () => readSettings())

  ipcMain.handle('settings:save', (_e, settings) => {
    // Merge sopra il file, non solo sopra i DEFAULTS: il renderer manda ogni
    // volta tutto il suo state, che non conosce le chiavi scritte dal main
    // (es. lastImportDir*), e con lo spread dei soli DEFAULTS le azzererebbe
    // al primo salvataggio qualsiasi (basta muovere il volume master)
    writeSettings(settings)
    return true
  })
}

module.exports = registerSettingsIpc
module.exports.DEFAULTS = DEFAULTS
module.exports.readSettings = readSettings
module.exports.writeSettings = writeSettings
