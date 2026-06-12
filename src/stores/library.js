import { defineStore } from 'pinia'

// Listener IPC registrato una sola volta anche se load() viene richiamato
let progressBound = false

export const useLibraryStore = defineStore('library', {
  state: () => ({
    tracks: [],
    search: '',
    downloading: false,
    // { phase: 'metadata'|'audio'|'convert'|'thumbnail', percent: number|null }
    progress: null,
    // Titolo della traccia in ri-download (null per i download nuovi)
    redownloadTitle: null,
    error: null
  }),
  getters: {
    byId: (s) => (id) => s.tracks.find((t) => t.id === id),
    // Tracce con file mancante ma ri-scaricabili da YouTube
    missingDownloadable: (s) => s.tracks.filter((t) => t.missing && t.source?.type === 'youtube'),
    filtered: (s) => {
      const q = s.search.trim().toLowerCase()
      return q ? s.tracks.filter((t) => t.title.toLowerCase().includes(q)) : s.tracks
    },
    byType() {
      return (type) => this.filtered.filter((t) => t.type === type)
    }
  },
  actions: {
    async load() {
      if (!progressBound) {
        progressBound = true
        window.api.ytdlp.onProgress((p) => { this.progress = p })
      }
      this.tracks = await window.api.library.list()
    },
    async persist() {
      // I Proxy reattivi non attraversano il contextBridge (structured clone):
      // serializzazione esplicita prima di ogni chiamata IPC con dati dello store
      await window.api.library.save(JSON.parse(JSON.stringify(this.tracks)))
    },
    async addFromYoutube(url) {
      this.downloading = true
      this.progress = null
      this.error = null
      try {
        const track = await window.api.ytdlp.download(url)
        if (!this.byId(track.id)) this.tracks.push(track)
        await this.persist()
        return track
      } catch (e) {
        this.error = e.message
        throw e
      } finally {
        this.downloading = false
        this.progress = null
      }
    },
    async importLocal() {
      const newTracks = await window.api.library.importLocal()
      this.tracks.push(...newTracks)
      if (newTracks.length) await this.persist()
    },
    async updateTrack(id, patch) {
      const t = this.byId(id)
      if (!t) return
      Object.assign(t, patch)
      // Modificare una traccia builtin crea una copia utente in index.json,
      // che da quel momento ha precedenza sul builtin
      if (t.builtin) t.builtin = false
      await this.persist()
    },
    // Ri-scarica le tracce YouTube con file mancante.
    // Senza argomento le ri-scarica tutte ("aggiorna libreria").
    async redownloadMissing(trackIds = null) {
      const targets = this.missingDownloadable.filter(
        (t) => !trackIds || trackIds.includes(t.id)
      )
      if (!targets.length || this.downloading) return
      this.downloading = true
      this.error = null
      try {
        for (const t of targets) {
          this.redownloadTitle = t.title
          this.progress = null
          try {
            await window.api.ytdlp.redownload(JSON.parse(JSON.stringify(t)))
            t.missing = false
          } catch (e) {
            // Resta segnata come mancante, prosegue con le altre
            this.error = e.message
          }
        }
      } finally {
        this.downloading = false
        this.progress = null
        this.redownloadTitle = null
      }
    }
  }
})
