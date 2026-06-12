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

module.exports = { DATA_DIR, DIRS, LIBRARY_INDEX, SETTINGS_FILE, ensureDataDirs }
