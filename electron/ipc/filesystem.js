const { ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DIRS, LIBRARY_INDEX, DATA_DIR } = require('../paths')

// SOUNDBOARD_BUILTIN_TRACKS: override usato dai test e2e
const BUILTIN_TRACKS_FILE =
  process.env.SOUNDBOARD_BUILTIN_TRACKS || path.join(__dirname, '..', 'builtin-tracks.json')

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

module.exports = function registerFilesystemIpc() {
  // ---- Boards ----
  ipcMain.handle('boards:list', () => {
    return fs
      .readdirSync(DIRS.boards)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(DIRS.boards, f), null))
      .filter(Boolean)
  })

  ipcMain.handle('boards:save', (_e, board) => {
    writeJson(path.join(DIRS.boards, `${board.id}.json`), board)
    return true
  })

  ipcMain.handle('boards:delete', (_e, boardId) => {
    const file = path.join(DIRS.boards, `${boardId}.json`)
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return true
  })

  // ---- Library ----
  ipcMain.handle('library:list', () => {
    const index = readJson(LIBRARY_INDEX, { version: 1, tracks: [] })
    const builtinIndex = readJson(BUILTIN_TRACKS_FILE, { version: 1, tracks: [] })

    // Builtin tracks that the user hasn't already added (user copy takes precedence)
    const userIds = new Set(index.tracks.map((t) => t.id))
    const builtins = builtinIndex.tracks
      .filter((t) => !userIds.has(t.id))
      .map((t) => ({ ...t, builtin: true }))

    const allTracks = [...builtins, ...index.tracks]
    // Verifica esistenza file locali
    allTracks.forEach((t) => {
      // i path usano sempre '/' nel JSON: ricostruiti coi separatori dell'OS
      const p = t.audioPath || t.mediaPath
      t.missing = !p || !fs.existsSync(path.join(DATA_DIR, ...p.split('/')))
    })
    return allTracks
  })

  ipcMain.handle('library:save', (_e, tracks) => {
    // builtin: mai persistite, vengono sempre da builtin-tracks.json.
    // missing/builtin: campi derivati, ricalcolati a ogni list
    const clean = tracks
      .filter((t) => !t.builtin)
      .map(({ missing, builtin, ...t }) => t)
    writeJson(LIBRARY_INDEX, { version: 1, tracks: clean })
    return true
  })

  // ---- Import audio locale ----
  ipcMain.handle('library:importLocal', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Importa audio',
      filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'wav', 'm4a', 'flac'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled) return []

    return filePaths.map((src) => {
      const id = 'local_' + crypto.randomBytes(6).toString('hex')
      const ext = path.extname(src)
      const destName = id + ext
      fs.copyFileSync(src, path.join(DIRS.downloaded, destName))
      return {
        id,
        version: 1,
        title: path.basename(src, ext),
        type: 'oneshot',
        volume: 1,
        audioPath: `library/downloaded/${destName}`,
        thumbnailPath: null,
        source: { type: 'local' }
      }
    })
  })

  // ---- Import visual locale (immagini/video per il cast) ----
  ipcMain.handle('library:importLocalVisual', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Importa immagine o video',
      filters: [
        { name: 'Immagini e video', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'mp4', 'm4v', 'webm'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled) return []

    return filePaths.map((src) => {
      const id = 'local_' + crypto.randomBytes(6).toString('hex')
      const ext = path.extname(src)
      const destName = id + ext
      fs.copyFileSync(src, path.join(DIRS.downloaded, destName))
      return {
        id,
        version: 1,
        title: path.basename(src, ext),
        type: 'visual',
        volume: 1,
        mediaPath: `library/downloaded/${destName}`,
        thumbnailPath: null,
        source: { type: 'local' }
      }
    })
  })
}
