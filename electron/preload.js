const { contextBridge, ipcRenderer } = require('electron')

// NB: i Proxy reattivi di Pinia vengono rifiutati già all'attraversamento
// del contextBridge, PRIMA che questo codice li veda: gli store devono
// serializzare (JSON) i propri dati prima di chiamare l'API.
// plain() qui resta come normalizzazione difensiva dei payload.
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
const invoke = (channel, payload) => ipcRenderer.invoke(channel, plain(payload))

contextBridge.exposeInMainWorld('api', {
  boards: {
    list: () => invoke('boards:list'),
    save: (board) => invoke('boards:save', board),
    delete: (id) => invoke('boards:delete', id)
  },
  library: {
    list: () => invoke('library:list'),
    save: (tracks) => invoke('library:save', tracks),
    importLocal: () => invoke('library:importLocal')
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (s) => invoke('settings:save', s)
  },
  ytdlp: {
    download: (url) => invoke('ytdlp:download', url),
    redownload: (track) => invoke('ytdlp:redownload', track),
    onProgress: (cb) => {
      const listener = (_e, p) => cb(p)
      ipcRenderer.on('ytdlp:progress', listener)
      return () => ipcRenderer.removeListener('ytdlp:progress', listener)
    }
  }
})
