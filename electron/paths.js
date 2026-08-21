const { app } = require('electron')
const path = require('path')
const fs = require('fs')

// In dev usa ./data nella root del progetto, in produzione userData.
// SOUNDBOARD_DATA_DIR: override usato dai test e2e per isolare i dati
const DATA_DIR =
  process.env.SOUNDBOARD_DATA_DIR ||
  (app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(__dirname, '..', 'data'))

const DIRS = {
  boards: path.join(DATA_DIR, 'boards'),
  builtinAmbience: path.join(DATA_DIR, 'library', 'builtin', 'ambience'),
  builtinOneshots: path.join(DATA_DIR, 'library', 'builtin', 'oneshots'),
  downloaded: path.join(DATA_DIR, 'library', 'downloaded'),
  thumbnails: path.join(DATA_DIR, 'library', 'thumbnails')
}

const LIBRARY_INDEX = path.join(DATA_DIR, 'library', 'index.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

function ensureDataDirs() {
  Object.values(DIRS).forEach((d) => fs.mkdirSync(d, { recursive: true }))
}

// In dev i binari stanno in ./bin (npm run fetch:ffmpeg), nel pacchetto sono
// extraResource. Stava scritto identico in tre file (cast, filesystem e la
// segmentazione HLS): tre punti da correggere il giorno che il layout cambia,
// e nessuno che avvisa se se ne aggiorna solo due.
function binDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', 'bin')
}

// Il nome nudo come ripiego: se non è nel pacchetto può essere nel PATH.
function ffmpegPath() {
  const bin = path.join(binDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  return fs.existsSync(bin) ? bin : 'ffmpeg'
}

module.exports = { DATA_DIR, DIRS, LIBRARY_INDEX, SETTINGS_FILE, ensureDataDirs, binDir, ffmpegPath }
