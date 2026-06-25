// Lettura/scrittura di board, libreria e settings.
// Stessi formati JSON e stesso layout su disco della versione Electron
// (electron/ipc/filesystem.js, settings.js, config.js): i file restano
// interscambiabili tra desktop e server.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DIRS, LIBRARY_INDEX, SETTINGS_FILE, BUILTIN_TRACKS_FILE, DATA_DIR } = require('./paths')

const SETTINGS_DEFAULTS = {
  version: 1,
  masterVolume: 0.8,
  musicTransition: 'crossfade',
  transitionDuration: 3000
}

const EXPORT_TYPE = 'dnd-soundboard-export'

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// ---- Boards ----
function listBoards() {
  return fs
    .readdirSync(DIRS.boards)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(DIRS.boards, f), null))
    .filter(Boolean)
}

function saveBoard(board) {
  writeJson(path.join(DIRS.boards, `${board.id}.json`), board)
  return true
}

function deleteBoard(id) {
  const file = path.join(DIRS.boards, `${id}.json`)
  if (fs.existsSync(file)) fs.unlinkSync(file)
  return true
}

// ---- Library ----
function listLibrary() {
  const index = readJson(LIBRARY_INDEX, { version: 1, tracks: [] })
  const builtinIndex = readJson(BUILTIN_TRACKS_FILE, { version: 1, tracks: [] })

  const userIds = new Set(index.tracks.map((t) => t.id))
  const builtins = builtinIndex.tracks
    .filter((t) => !userIds.has(t.id))
    .map((t) => ({ ...t, builtin: true }))

  const all = [...builtins, ...index.tracks]
  all.forEach((t) => {
    t.missing = !fs.existsSync(path.join(DATA_DIR, ...t.audioPath.split('/')))
  })
  return all
}

function saveLibrary(tracks) {
  const clean = tracks.filter((t) => !t.builtin).map(({ missing, builtin, ...t }) => t)
  writeJson(LIBRARY_INDEX, { version: 1, tracks: clean })
  return true
}

// Import audio caricato dal browser (un file per chiamata)
function importLocalFile(buffer, originalName) {
  const id = 'local_' + crypto.randomBytes(6).toString('hex')
  const ext = path.extname(originalName) || '.mp3'
  const destName = id + ext
  fs.writeFileSync(path.join(DIRS.downloaded, destName), buffer)
  return {
    id,
    version: 1,
    title: path.basename(originalName, ext),
    type: 'oneshot',
    volume: 1,
    audioPath: `library/downloaded/${destName}`,
    thumbnailPath: null,
    source: { type: 'local' }
  }
}

// ---- Settings ----
function getSettings() {
  return { ...SETTINGS_DEFAULTS, ...readJson(SETTINGS_FILE, {}) }
}

function saveSettings(s) {
  writeJson(SETTINGS_FILE, { ...SETTINGS_DEFAULTS, ...s })
  return true
}

// ---- Export / Import ----
function exportBundle() {
  return {
    type: EXPORT_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    boards: listBoards(),
    library: readJson(LIBRARY_INDEX, { version: 1, tracks: [] }).tracks
  }
}

function importBundle(bundle) {
  if (!bundle || bundle.type !== EXPORT_TYPE) {
    throw new Error('File di configurazione non valido')
  }
  if (bundle.settings) saveSettings(bundle.settings)

  const existing = readJson(LIBRARY_INDEX, { version: 1, tracks: [] }).tracks
  const byId = new Map(existing.map((t) => [t.id, t]))
  let addedTracks = 0
  for (const t of bundle.library || []) {
    if (!t?.id) continue
    if (!byId.has(t.id)) addedTracks++
    byId.set(t.id, t)
  }
  writeJson(LIBRARY_INDEX, { version: 1, tracks: [...byId.values()] })

  let boards = 0
  for (const b of bundle.boards || []) {
    if (!b?.id) continue
    saveBoard(b)
    boards++
  }
  return { boards, tracks: (bundle.library || []).length, addedTracks }
}

module.exports = {
  listBoards,
  saveBoard,
  deleteBoard,
  listLibrary,
  saveLibrary,
  importLocalFile,
  getSettings,
  saveSettings,
  exportBundle,
  importBundle
}
