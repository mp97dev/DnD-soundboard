import { defineStore } from 'pinia'

// Listener IPC registrato una sola volta anche se load() viene richiamato
let progressBound = false

// Quanti download possono procedere in parallelo. yt-dlp + conversione ffmpeg
// sono pesanti: un limite basso tiene l'app reattiva senza saturare CPU/rete.
const MAX_CONCURRENT = 3

const uid = () => Math.random().toString(36).slice(2, 10)
const clone = (v) => JSON.parse(JSON.stringify(v))

// ---- Cartelle ----
// L'appartenenza è MULTIPLA: la stessa traccia può stare in più cartelle
// (folderIds sulla traccia, come i tag). È il modello delle playlist, non
// quello delle directory, perché il caso d'uso è tenere separate le campagne e
// poi riusarne pezzi in una terza: la traccia condivisa sta davvero in
// entrambe, senza copie di file e senza dover decidere di chi "è".
// I tag restano ortogonali: un filtro su 'combattimento' attraversa le cartelle.

// Sentinella del filtro "Senza cartella": non è uno stato scritto sulla
// traccia, è il complemento di "sta in almeno una cartella". uid() produce 8
// caratteri base36, quindi non può collidere con l'id di una cartella vera.
export const UNFILED = '__unfiled__'

// Stato di vista (cartella scelta, modo di confronto dei tag): localStorage,
// come la larghezza della sidebar. Non in index.json e non in settings.json —
// è di questo PC, non della libreria, e non deve viaggiare negli export.
const LS_FOLDER = 'librarySelectedFolder'
const LS_TAG_MODE = 'libraryTagMatchMode'
// Fuori dal browser (test headless dei getter) localStorage non esiste: lo
// stato della vista non deve impedire allo store di essere creato.
const ls = typeof localStorage === 'undefined' ? null : localStorage

// I tag suggeriti per il primo utilizzo stanno nei cataloghi
// (library.tagSuggestions): sono testo di interfaccia e cambiano con la lingua.
// I tag già scritti sulle tracce invece NON si toccano — sono dati dell'utente,
// e una traccia taggata 'foresta' resta 'foresta' anche in inglese. Qui dentro
// nessuna azione riscrive t.tags all'infuori di updateTrack, che parte solo
// dall'editor: cambiare lingua non può muovere niente su disco.

export const useLibraryStore = defineStore('library', {
  state: () => ({
    tracks: [],
    // Albero delle cartelle: { id, name, parentId, color }
    folders: [],
    search: '',
    // Tag selezionati per filtrare la libreria
    tagFilter: [],
    // Come si combinano i tag selezionati: 'all' = la traccia li ha tutti
    // (comportamento storico), 'any' = ne basta uno
    tagMatchMode: ls && ls.getItem(LS_TAG_MODE) === 'any' ? 'any' : 'all',
    // Cartella selezionata: null = tutta la libreria, UNFILED = solo le tracce
    // che non stanno in nessuna cartella
    selectedFolderId: (ls && ls.getItem(LS_FOLDER)) || null,
    // Coda di download. Ogni job:
    // { id, kind:'download'|'redownload', url, ytId, trackId, title,
    //   status:'queued'|'active'|'error', phase, percent, error }
    // I job completati con successo vengono rimossi (feedback = traccia in lista)
    jobs: [],
    // Errore globale (es. espansione playlist fallita)
    error: null,
    // Import di file locali in corso (le copie di file grossi durano parecchio)
    importing: false,
    // Espansione playlist in corso (--flat-playlist può durare qualche secondo)
    expanding: false,
    // Playlist in attesa di conferma: { entries, kind, single }
    // single = il video puntato dall'URL (v=...), se presente nella playlist
    pendingBulk: null
  }),
  getters: {
    byId: (s) => (id) => s.tracks.find((t) => t.id === id),
    // Tracce con file mancante ma ri-scaricabili da YouTube
    missingDownloadable: (s) => s.tracks.filter((t) => t.missing && t.source?.type === 'youtube'),
    // Tracce con file mancante e NESSUN URL sorgente (import locali su un
    // altro PC): impossibili da recuperare in automatico, vanno reimportate
    missingLocal: (s) => s.tracks.filter((t) => t.missing && t.source?.type !== 'youtube'),
    // Almeno un download in coda o in corso
    downloading: (s) => s.jobs.some((j) => j.status === 'queued' || j.status === 'active'),
    // ---- Cartelle ----
    folderById: (s) => (id) => s.folders.find((f) => f.id === id),
    // Id delle cartelle che esistono davvero, per ignorare i riferimenti orfani
    knownFolderIds: (s) => new Set(s.folders.map((f) => f.id)),
    // Figlie dirette (parentId null = radici), in ordine alfabetico
    childFolders: (s) => (parentId) =>
      s.folders
        .filter((f) => (f.parentId || null) === (parentId || null))
        .sort((a, b) => a.name.localeCompare(b.name)),
    // Una cartella PIÙ tutta la sua discendenza. Selezionare una campagna deve
    // mostrare anche quello che sta nelle sue sotto-cartelle: chi ha diviso
    // "Campagna 1" in "combattimenti" e "taverne" si aspetta di rivedere tutto
    // insieme scegliendo la campagna, non una lista vuota. Il Set fa anche da
    // guardia contro i cicli, se un index.json arriva già rotto da fuori.
    folderWithDescendants: (s) => (id) => {
      const out = new Set()
      const walk = (fid) => {
        if (!fid || out.has(fid)) return
        out.add(fid)
        for (const f of s.folders) if (f.parentId === fid) walk(f.id)
      }
      walk(id)
      return out
    },
    // Le cartelle a cui una traccia appartiene DAVVERO: un id orfano (cartella
    // cancellata altrove, bundle importato a metà) non deve contare, altrimenti
    // la traccia sparirebbe sia dalle cartelle sia da "Senza cartella".
    trackFolderIds() {
      return (t) => (t.folderIds || []).filter((id) => this.knownFolderIds.has(id))
    },
    // Conteggio per cartella: include le discendenti, così il numero è quello
    // che si vede selezionandola. Volutamente sul totale della libreria e non
    // su `filtered`: un conteggio che balla mentre si scrive nella ricerca non
    // dice più quanto c'è dentro la cartella.
    folderTrackCount() {
      return (id) => {
        const wanted = this.folderWithDescendants(id)
        return this.tracks.filter((t) => (t.folderIds || []).some((fid) => wanted.has(fid))).length
      }
    },
    unfiledCount() {
      return this.tracks.filter((t) => !this.trackFolderIds(t).length).length
    },
    filtered(s) {
      const q = s.search.trim().toLowerCase()
      let list = q
        ? s.tracks.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              (t.tags || []).some((tag) => tag.toLowerCase().includes(q))
          )
        : s.tracks
      // Cartella e tag sono filtri indipendenti che si sommano alla ricerca.
      // null = tutta la libreria; una cartella scelta include sempre le sue
      // discendenti; UNFILED è l'esatto complemento delle cartelle esistenti.
      if (s.selectedFolderId === UNFILED) {
        list = list.filter((t) => !this.trackFolderIds(t).length)
      } else if (s.selectedFolderId) {
        const wanted = this.folderWithDescendants(s.selectedFolderId)
        list = list.filter((t) => (t.folderIds || []).some((id) => wanted.has(id)))
      }
      if (s.tagFilter.length) {
        // 'any' è quello che serve per pescare 'combattimento' da tutte le
        // campagne insieme; 'all' per stringere su una traccia precisa.
        list = s.tagMatchMode === 'any'
          ? list.filter((t) => s.tagFilter.some((tag) => (t.tags || []).includes(tag)))
          : list.filter((t) => s.tagFilter.every((tag) => (t.tags || []).includes(tag)))
      }
      return list
    },
    // Tutti i tag usati in libreria, ordinati alfabeticamente
    allTags: (s) => [...new Set(s.tracks.flatMap((t) => t.tags || []))].sort((a, b) => a.localeCompare(b)),
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
      const res = await window.api.library.list()
      // Forma nuova { tracks, folders }; un array nudo è un backend più
      // indietro (server web non aggiornato) e vale come "nessuna cartella"
      this.tracks = Array.isArray(res) ? res : res.tracks || []
      this.folders = Array.isArray(res) ? [] : res.folders || []
      // Una cartella selezionata che non esiste più (cancellata su un altro PC,
      // libreria sostituita da un import) lascerebbe la libreria vuota senza un
      // modo ovvio di sbloccarla: si torna a "tutte".
      if (
        this.selectedFolderId &&
        this.selectedFolderId !== UNFILED &&
        !this.folderById(this.selectedFolderId)
      ) {
        this.selectFolder(null)
      }
    },
    async persist() {
      // I Proxy reattivi non attraversano il contextBridge (structured clone):
      // serializzazione esplicita prima di ogni chiamata IPC con dati dello store
      await window.api.library.save({ tracks: clone(this.tracks), folders: clone(this.folders) })
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
          const dl = job.kind === 'download-visual'
            ? window.api.ytdlp.downloadVisual
            : window.api.ytdlp.download
          const track = await dl(job.url, job.id)
          if (!this.byId(track.id)) {
            this._fileNewTracks([track])
            this.tracks.push(track)
          }
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
    // asVisual: scarica il VIDEO mp4 (per il cast) invece dell'audio mp3.
    // Le playlist NON partono subito: restano in pendingBulk finché l'utente
    // non conferma (confirmBulk) o annulla (cancelBulk).
    async addFromYoutubeBulk(text, { asVisual = false } = {}) {
      this.error = null
      let entries
      this.expanding = true
      try {
        entries = await window.api.ytdlp.expand(text)
      } catch (e) {
        this.error = e.message
        return
      } finally {
        this.expanding = false
      }
      const kind = asVisual ? 'download-visual' : 'download'
      if (/[?&]list=/.test(text) && entries.length > 1) {
        // L'URL puntava anche a un video preciso (v=...)? Offri "solo questo"
        const m = String(text).match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)
        const single = m
          ? entries.find((en) => en.ytId === m[1]) ||
            { url: `https://youtu.be/${m[1]}`, ytId: m[1], title: `https://youtu.be/${m[1]}` }
          : null
        this.pendingBulk = { entries, kind, single }
        return
      }
      this._queueEntries(entries, kind)
    },
    _queueEntries(entries, kind) {
      const idPrefix = kind === 'download-visual' ? 'ytv_' : 'yt_'
      for (const en of entries) {
        // Salta se già in libreria e presente, o già in coda/in corso
        const existing = en.ytId && this.byId(`${idPrefix}${en.ytId}`)
        if (existing && !existing.missing) continue
        if (this.jobs.some((j) => j.url === en.url && j.kind === kind && j.status !== 'error')) continue
        this.jobs.push({
          id: uid(),
          kind,
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
    // Conferma la playlist in sospeso. onlySingle: solo il video dell'URL.
    confirmBulk(onlySingle = false) {
      if (!this.pendingBulk) return
      const { entries, kind, single } = this.pendingBulk
      this.pendingBulk = null
      this._queueEntries(onlySingle && single ? [single] : entries, kind)
    },
    cancelBulk() {
      this.pendingBulk = null
    },
    // Interrompe un job: rimosso dalla coda e, se attivo, il processo yt-dlp
    // viene ucciso nel backend
    cancelJob(id) {
      const job = this.jobs.find((j) => j.id === id)
      if (!job) return
      this.jobs = this.jobs.filter((j) => j.id !== id)
      if (job.status === 'active') {
        Promise.resolve(window.api.ytdlp.cancel(id)).catch(() => {})
      }
      this._pump()
    },
    // Ferma l'intera coda di download (es. playlist accodata per sbaglio)
    cancelAllJobs() {
      const active = this.jobs.filter((j) => j.status === 'active')
      this.jobs = this.jobs.filter((j) => j.status === 'error')
      for (const j of active) {
        Promise.resolve(window.api.ytdlp.cancel(j.id)).catch(() => {})
      }
    },
    // Comodità: singolo URL (delega al flusso bulk)
    addFromYoutube(url) {
      return this.addFromYoutubeBulk(url)
    },

    async importLocal() {
      this.importing = true
      try {
        const newTracks = await window.api.library.importLocal()
        this._fileNewTracks(newTracks)
        this.tracks.push(...newTracks)
        if (newTracks.length) await this.persist()
      } finally {
        this.importing = false
      }
    },
    async importLocalVisual() {
      this.importing = true
      try {
        const newTracks = await window.api.library.importLocalVisual()
        this._fileNewTracks(newTracks)
        this.tracks.push(...newTracks)
        if (newTracks.length) await this.persist()
      } finally {
        this.importing = false
      }
    },
    // Aggiunge/rimuove un tag dal filtro attivo
    toggleTagFilter(tag) {
      const i = this.tagFilter.indexOf(tag)
      if (i === -1) this.tagFilter.push(tag)
      else this.tagFilter.splice(i, 1)
    },
    setTagMatchMode(mode) {
      this.tagMatchMode = mode === 'any' ? 'any' : 'all'
      if (ls) ls.setItem(LS_TAG_MODE, this.tagMatchMode)
    },

    // ---- Cartelle ----
    selectFolder(id) {
      this.selectedFolderId = id || null
      if (!ls) return
      if (this.selectedFolderId) ls.setItem(LS_FOLDER, this.selectedFolderId)
      else ls.removeItem(LS_FOLDER)
    },
    async createFolder(name, parentId = null) {
      const folder = {
        id: uid(),
        name: String(name || '').trim(),
        parentId: parentId || null,
        color: null
      }
      this.folders.push(folder)
      await this.persist()
      return folder.id
    },
    async renameFolder(id, name) {
      const f = this.folderById(id)
      const next = String(name || '').trim()
      if (!f || !next) return
      f.name = next
      await this.persist()
    },
    async setFolderColor(id, color) {
      const f = this.folderById(id)
      if (!f) return
      f.color = color || null
      await this.persist()
    },
    // Sposta una cartella sotto un'altra. Rifiuta se la destinazione è la
    // cartella stessa o una sua discendente: il ramo si staccherebbe dalla
    // radice e resterebbe in un ciclo, invisibile nell'albero e quindi non più
    // né selezionabile né cancellabile dalla UI.
    async moveFolder(id, parentId) {
      const f = this.folderById(id)
      if (!f) return false
      const target = parentId || null
      if (target && (target === id || !this.folderById(target))) return false
      if (target && this.folderWithDescendants(id).has(target)) return false
      f.parentId = target
      await this.persist()
      return true
    },
    // Cancellare una cartella NON cancella tracce: sparisce il contenitore, non
    // il contenuto — i file su disco non si toccano mai. Le figlie salgono al
    // genitore della cancellata invece di sparire con lei: perdere un ramo
    // intero per un click su una cartella di mezzo sarebbe una perdita
    // silenziosa di lavoro.
    async deleteFolder(id) {
      const f = this.folderById(id)
      if (!f) return
      const parent = f.parentId || null
      this.folders = this.folders.filter((x) => x.id !== id)
      for (const child of this.folders) if (child.parentId === id) child.parentId = parent
      for (const t of this.tracks) {
        if (Array.isArray(t.folderIds) && t.folderIds.includes(id)) {
          t.folderIds = t.folderIds.filter((x) => x !== id)
        }
      }
      if (this.selectedFolderId === id) this.selectFolder(null)
      await this.persist()
    },
    // Mette una traccia in una cartella (AGGIUNGE, non sposta: può stare in più
    // cartelle insieme). Passa da updateTrack perché è lì che una traccia
    // builtin diventa una copia utente: scrivendo folderIds direttamente,
    // l'appartenenza finirebbe su un oggetto che library:save scarta e
    // sparirebbe al riavvio.
    async addTrackToFolder(trackId, folderId) {
      const t = this.byId(trackId)
      if (!t || !this.folderById(folderId)) return
      const ids = t.folderIds || []
      if (ids.includes(folderId)) return
      await this.updateTrack(trackId, { folderIds: [...ids, folderId] })
    },
    async removeTrackFromFolder(trackId, folderId) {
      const t = this.byId(trackId)
      if (!t) return
      await this.updateTrack(trackId, {
        folderIds: (t.folderIds || []).filter((id) => id !== folderId)
      })
    },
    // Le tracce nuove nascono nella cartella selezionata. Senza, scaricare con
    // una campagna aperta darebbe una traccia che non compare da nessuna parte
    // (il filtro attivo la nasconde subito) e sembrerebbe un download fallito.
    _fileNewTracks(tracks) {
      const id = this.selectedFolderId
      if (!id || id === UNFILED || !this.folderById(id)) return
      for (const t of tracks) if (!t.folderIds?.length) t.folderIds = [id]
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
