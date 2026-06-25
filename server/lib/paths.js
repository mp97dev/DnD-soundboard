const path = require('path')
const fs = require('fs')

// La root del repo (questo file è in <repo>/server/lib/)
const REPO_ROOT = path.join(__dirname, '..', '..')

// I dati (board, libreria, mp3, settings) vivono FUORI dal repo così che
// `git pull`/reset durante gli aggiornamenti non li tocchi mai.
// In LXC: /var/lib/dnd-soundboard (vedi systemd unit). In locale: <repo>/data.
const DATA_DIR = process.env.SOUNDBOARD_DATA_DIR || path.join(REPO_ROOT, 'data')

const DIRS = {
  boards: path.join(DATA_DIR, 'boards'),
  downloaded: path.join(DATA_DIR, 'library', 'downloaded'),
  thumbnails: path.join(DATA_DIR, 'library', 'thumbnails')
}

const LIBRARY_INDEX = path.join(DATA_DIR, 'library', 'index.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

// Le tracce builtin sono CODICE (versionato), non dati utente.
const BUILTIN_TRACKS_FILE =
  process.env.SOUNDBOARD_BUILTIN_TRACKS || path.join(REPO_ROOT, 'electron', 'builtin-tracks.json')

// Build del renderer servita ai client
const RENDERER_DIR = path.join(REPO_ROOT, 'dist', 'renderer')

// yt-dlp / ffmpeg: prima ./bin (fetch:ytdlp), poi PATH di sistema (apt)
const BIN_DIR = path.join(REPO_ROOT, 'bin')

function ensureDataDirs() {
  Object.values(DIRS).forEach((d) => fs.mkdirSync(d, { recursive: true }))
}

module.exports = {
  REPO_ROOT,
  DATA_DIR,
  DIRS,
  LIBRARY_INDEX,
  SETTINGS_FILE,
  BUILTIN_TRACKS_FILE,
  RENDERER_DIR,
  BIN_DIR,
  ensureDataDirs
}
