const { ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { DIRS, LIBRARY_INDEX, SETTINGS_FILE } = require('../paths')

// Presi da ipc/settings.js invece di ricopiarli: la copia locale era commentata
// "tenuta allineata" ed era già indietro di quattro chiavi. Un default che
// diverge qui si nota solo il giorno in cui il file è illeggibile, cioè tardi.
const { DEFAULTS: DEFAULT_SETTINGS } = require('./settings')

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

    const index = readJson(LIBRARY_INDEX, { version: 1, tracks: [] })
    const bundle = {
      type: EXPORT_TYPE,
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: readJson(SETTINGS_FILE, DEFAULT_SETTINGS),
      boards: listBoards(),
      // Solo le tracce utente: le builtin non stanno in index.json
      library: index.tracks,
      // Le cartelle viaggiano col bundle: senza, le tracce arriverebbero con i
      // loro folderIds ma senza l'albero a cui puntano, e la divisione per
      // campagna si perderebbe sul PC di destinazione.
      libraryFolders: index.folders || []
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
    const index = readJson(LIBRARY_INDEX, { version: 1, tracks: [] })
    const byId = new Map(index.tracks.map((t) => [t.id, t]))
    let addedTracks = 0
    for (const t of bundle.library || []) {
      if (!t?.id) continue
      if (!byId.has(t.id)) addedTracks++
      byId.set(t.id, t)
    }
    // Stesso merge per le cartelle. Un bundle vecchio (senza libraryFolders)
    // non deve azzerare l'albero già presente su questo PC.
    const foldersById = new Map((index.folders || []).map((f) => [f.id, f]))
    for (const f of bundle.libraryFolders || []) {
      if (!f?.id) continue
      foldersById.set(f.id, f)
    }
    writeJson(LIBRARY_INDEX, {
      version: 1,
      folders: [...foldersById.values()],
      tracks: [...byId.values()]
    })

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
