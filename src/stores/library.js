import { defineStore } from 'pinia'

// Listener IPC registrato una sola volta anche se load() viene richiamato
let progressBound = false

// Quanti download possono procedere in parallelo. yt-dlp + conversione ffmpeg
// sono pesanti: un limite basso tiene l'app reattiva senza saturare CPU/rete.
const MAX_CONCURRENT = 3

const uid = () => Math.random().toString(36).slice(2, 10)
const clone = (v) => JSON.parse(JSON.stringify(v))

export const useLibraryStore = defineStore('library', {
  state: () => ({
    tracks: [],
    search: '',
    // Coda di download. Ogni job:
    // { id, kind:'download'|'redownload', url, ytId, trackId, title,
    //   status:'queued'|'active'|'error', phase, percent, error }
    // I job completati con successo vengono rimossi (feedback = traccia in lista)
    jobs: [],
    // Errore globale (es. espansione playlist fallita)
    error: null
  }),
  getters: {
    byId: (s) => (id) => s.tracks.find((t) => t.id === id),
    // Tracce con file mancante ma ri-scaricabili da YouTube
    missingDownloadable: (s) => s.tracks.filter((t) => t.missing && t.source?.type === 'youtube'),
    // Almeno un download in coda o in corso
    downloading: (s) => s.jobs.some((j) => j.status === 'queued' || j.status === 'active'),
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
        window.api.ytdlp.onProgress((p) => {
          const job = this.jobs.find((j) => j.id === p.jobId)
          if (job) {
            job.phase = p.phase
            job.percent = p.percent
          }
        })
      }
      this.tracks = await window.api.library.list()
    },
    async persist() {
      // I Proxy reattivi non attraversano il contextBridge (structured clone):
      // serializzazione esplicita prima di ogni chiamata IPC con dati dello store
      await window.api.library.save(clone(this.tracks))
    },

    // ---- Coda di download ----
    // Avvia tanti job in coda quanti i posti liberi rispetto al limite.
    _pump() {
      const active = this.jobs.filter((j) => j.status === 'active').length
      for (let slots = MAX_CONCURRENT - active; slots > 0; slots--) {
        const next = this.jobs.find((j) => j.status === 'queued')
        if (!next) break
        this._runJob(next) // volutamente non awaited: gira in parallelo
      }
    },
    async _runJob(job) {
      job.status = 'active'
      job.phase = 'metadata'
      job.percent = null
      job.error = null
      try {
        if (job.kind === 'redownload') {
          const track = this.byId(job.trackId)
          await window.api.ytdlp.redownload(clone(track), job.id)
          if (track) track.missing = false
        } else {
          const track = await window.api.ytdlp.download(job.url, job.id)
          if (!this.byId(track.id)) this.tracks.push(track)
          await this.persist()
        }
        // Successo: il job sparisce dalla lista
        this.jobs = this.jobs.filter((j) => j.id !== job.id)
      } catch (e) {
        job.status = 'error'
        job.percent = null
        job.error = e.message
      } finally {
        this._pump()
      }
    },
    // Scarta i job in errore (chiusura manuale)
    dismissJob(id) {
      this.jobs = this.jobs.filter((j) => j.id !== id)
    },
    clearFinishedJobs() {
      this.jobs = this.jobs.filter((j) => j.status !== 'error')
    },

    // Accetta uno o più URL / playlist (testo multilinea) e accoda i download.
    async addFromYoutubeBulk(text) {
      this.error = null
      let entries
      try {
        entries = await window.api.ytdlp.expand(text)
      } catch (e) {
        this.error = e.message
        return
      }
      for (const en of entries) {
        // Salta se già in libreria e presente, o già in coda/in corso
        const existing = en.ytId && this.byId(`yt_${en.ytId}`)
        if (existing && !existing.missing) continue
        if (this.jobs.some((j) => j.url === en.url && j.status !== 'error')) continue
        this.jobs.push({
          id: uid(),
          kind: 'download',
          url: en.url,
          ytId: en.ytId,
          trackId: null,
          title: en.title || en.url,
          status: 'queued',
          phase: null,
          percent: null,
          error: null
        })
      }
      this._pump()
    },
    // Comodità: singolo URL (delega al flusso bulk)
    addFromYoutube(url) {
      return this.addFromYoutubeBulk(url)
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
    // Ri-scarica le tracce YouTube con file mancante accodandole come job.
    // Senza argomento le ri-scarica tutte ("aggiorna libreria").
    redownloadMissing(trackIds = null) {
      const targets = this.missingDownloadable.filter(
        (t) => !trackIds || trackIds.includes(t.id)
      )
      for (const t of targets) {
        if (this.jobs.some((j) => j.trackId === t.id && j.status !== 'error')) continue
        this.jobs.push({
          id: uid(),
          kind: 'redownload',
          url: t.source.url,
          ytId: t.source.youtubeId,
          trackId: t.id,
          title: t.title,
          status: 'queued',
          phase: null,
          percent: null,
          error: null
        })
      }
      this._pump()
    }
  }
})
