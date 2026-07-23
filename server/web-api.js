// Shim client servito al browser (tablet). Definisce window.api con la STESSA
// superficie del preload Electron, ma su HTTP + WebSocket invece che IPC.
// Caricato come <script> classico nel <head> PRIMA del bundle dell'app, così
// window.api esiste quando gli store lo usano.
(function () {
  function json(r) {
    if (!r.ok) return r.json().then((e) => { throw new Error(e.error || r.statusText) }, () => { throw new Error(r.statusText) })
    return r.json()
  }
  const get = (u) => fetch(u).then(json)
  const post = (u, body) =>
    fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json)

  // ---- Progresso download via WebSocket ----
  const progressCbs = new Set()
  let ws
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws')
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data)
        if (m.type === 'progress') progressCbs.forEach((cb) => cb(m))
      } catch { /* ignora */ }
    }
    ws.onclose = () => setTimeout(connect, 1500) // riconnessione
  }
  connect()

  // Apre un file picker e risolve con i File scelti (o [] se annullato)
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = accept
      inp.multiple = !!multiple
      inp.onchange = () => resolve([...inp.files])
      inp.oncancel = () => resolve([])
      inp.click()
    })
  }

  window.api = {
    boards: {
      list: () => get('/api/boards'),
      save: (b) => post('/api/boards', b),
      delete: (id) => fetch('/api/boards/' + encodeURIComponent(id), { method: 'DELETE' }).then(json)
    },
    library: {
      list: () => get('/api/library'),
      save: (tracks) => post('/api/library', tracks),
      importLocal: async () => {
        const files = await pickFiles('audio/*', true)
        const out = []
        for (const f of files) {
          const t = await fetch('/api/library/import', {
            method: 'POST',
            headers: { 'X-Filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' },
            body: f
          }).then(json)
          out.push(t)
        }
        return out
      },
      importLocalVisual: async () => {
        const files = await pickFiles('image/*,video/*', true)
        const out = []
        for (const f of files) {
          const t = await fetch('/api/library/import?kind=visual', {
            method: 'POST',
            headers: { 'X-Filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' },
            body: f
          }).then(json)
          out.push(t)
        }
        return out
      }
    },
    cast: {
      devices: () => get('/api/cast/devices'),
      status: () => get('/api/cast/status'),
      show: ({ host, path, title }) => post('/api/cast/show', { host, path, title }),
      blank: () => post('/api/cast/blank', {}),
      stop: () => post('/api/cast/stop', {})
    },
    settings: {
      get: () => get('/api/settings'),
      save: (s) => post('/api/settings', s)
    },
    config: {
      export: async () => {
        // Lascia scaricare il bundle al browser (Content-Disposition lato server)
        const a = document.createElement('a')
        a.href = '/api/config/export'
        a.download = ''
        document.body.appendChild(a)
        a.click()
        a.remove()
        return true
      },
      import: async () => {
        const [f] = await pickFiles('.dnds,application/json,.json', false)
        if (!f) return null
        let bundle
        try {
          bundle = JSON.parse(await f.text())
        } catch {
          throw new Error('JSON non valido')
        }
        return post('/api/config/import', bundle)
      }
    },
    ytdlp: {
      expand: (text) => post('/api/ytdlp/expand', { text }),
      download: (url, jobId) => post('/api/ytdlp/download', { url, jobId }),
      downloadVisual: (url, jobId) => post('/api/ytdlp/download-visual', { url, jobId }),
      redownload: (track, jobId) => post('/api/ytdlp/redownload', { track, jobId }),
      cancel: (jobId) => post('/api/ytdlp/cancel', { jobId }),
      onProgress: (cb) => {
        progressCbs.add(cb)
        return () => progressCbs.delete(cb)
      }
    }
  }

  // Service worker: cache della shell + thumbnail per UI offline e per ridurre
  // l'egress. L'audio (range request) lo gestisce la cache HTTP (immutable).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }
})()
