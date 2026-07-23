const { ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { DIRS, LIBRARY_INDEX, SETTINGS_FILE } = require('../paths')

// Tenuto allineato con i DEFAULTS in ipc/settings.js
const DEFAULT_SETTINGS = {
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

function listBoards() {
  return fs
    .readdirSync(DIRS.boards)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(DIRS.boards, f), null))
    .filter(Boolean)
}

module.exports = function registerConfigIpc() {
  // Esporta settings + board + indice libreria (metadati delle tracce, NON
  // gli mp3). Le tracce YouTube portano con sé source.url: sul dispositivo di
  // import i file mancanti vengono ri-scaricati dal flusso redownloadMissing.
  ipcMain.handle('config:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Esporta configurazione',
      defaultPath: `soundboard-export-${new Date().toISOString().slice(0, 10)}.dnds`,
      filters: [
        { name: 'DnD Soundboard', extensions: ['dnds'] },
        { name: 'JSON', extensions: ['json'] }
      ]
    })
    if (canceled || !filePath) return false

    const bundle = {
      type: EXPORT_TYPE,
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: readJson(SETTINGS_FILE, DEFAULT_SETTINGS),
      boards: listBoards(),
      // Solo le tracce utente: le builtin non stanno in index.json
      library: readJson(LIBRARY_INDEX, { version: 1, tracks: [] }).tracks
    }
    writeJson(filePath, bundle)
    return true
  })

  ipcMain.handle('config:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Importa configurazione',
      filters: [{ name: 'DnD Soundboard', extensions: ['dnds', 'json'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths.length) return null

    const bundle = readJson(filePaths[0], null)
    if (!bundle || bundle.type !== EXPORT_TYPE) {
      throw new Error('File di configurazione non valido')
    }

    // Settings: sovrascritte
    if (bundle.settings) {
      writeJson(SETTINGS_FILE, { ...DEFAULT_SETTINGS, ...bundle.settings })
    }

    // Libreria: merge per id, la traccia importata ha precedenza
    const existing = readJson(LIBRARY_INDEX, { version: 1, tracks: [] }).tracks
    const byId = new Map(existing.map((t) => [t.id, t]))
    let addedTracks = 0
    for (const t of bundle.library || []) {
      if (!t?.id) continue
      if (!byId.has(t.id)) addedTracks++
      byId.set(t.id, t)
    }
    writeJson(LIBRARY_INDEX, { version: 1, tracks: [...byId.values()] })

    // Board: una per file, sovrascritte per id
    let importedBoards = 0
    for (const b of bundle.boards || []) {
      if (!b?.id) continue
      writeJson(path.join(DIRS.boards, `${b.id}.json`), b)
      importedBoards++
    }

    return {
      boards: importedBoards,
      tracks: (bundle.library || []).length,
      addedTracks
    }
  })
}
