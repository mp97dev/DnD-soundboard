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
    importLocal: () => invoke('library:importLocal'),
    importLocalVisual: () => invoke('library:importLocalVisual')
  },
  cast: {
    devices: () => invoke('cast:devices'),
    status: () => invoke('cast:status'),
    show: ({ host, path, title }) => invoke('cast:show', { host, path, title }),
    blank: () => invoke('cast:blank'),
    stop: () => invoke('cast:stop')
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (s) => invoke('settings:save', s)
  },
  config: {
    export: () => invoke('config:export'),
    import: () => invoke('config:import')
  },
  ytdlp: {
    expand: (text) => invoke('ytdlp:expand', text),
    download: (url, jobId) => invoke('ytdlp:download', { url, jobId }),
    downloadVisual: (url, jobId) => invoke('ytdlp:downloadVisual', { url, jobId }),
    redownload: (track, jobId) => invoke('ytdlp:redownload', { track, jobId }),
    cancel: (jobId) => invoke('ytdlp:cancel', jobId),
    onProgress: (cb) => {
      const listener = (_e, p) => cb(p)
      ipcRenderer.on('ytdlp:progress', listener)
      return () => ipcRenderer.removeListener('ytdlp:progress', listener)
    }
  }
})
