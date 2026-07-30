<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useLibraryStore, UNFILED } from '../stores/library'
import { mediaUrl } from '../media'
import { rt, t, tm } from '../i18n'

const library = useLibraryStore()
const ytUrl = ref('')

// Tutti i tag noti (usati + suggeriti), per il datalist dell'editor inline.
// I suggeriti seguono la lingua, i tag già scritti sulle tracce no: quelli sono
// dati dell'utente e vengono letti da library.allTags esattamente come stanno.
const knownTags = computed(() => [
  ...new Set([...library.allTags, ...tm('library.tagSuggestions').map(rt)])
])

// Chip del filtro: i tag presenti in libreria PIÙ quelli ancora attivi che non
// esistono più su nessuna traccia. Senza questi ultimi, togliere l'ultimo tag
// "castello" mentre il filtro su "castello" è attivo farebbe sparire il chip
// ma non il filtro: libreria vuota e nessun modo visibile per sbloccarla.
const filterTags = computed(() =>
  [...new Set([...library.allTags, ...library.tagFilter])].sort((a, b) => a.localeCompare(b))
)

// ---- Albero delle cartelle ----
// Disegnato come lista piatta con rientro invece che con un componente
// ricorsivo: la sidebar parte da 200px, e a quella larghezza l'unica cosa che
// serve davvero della gerarchia è qualche pixel di indentazione.
// Le cartelle richiuse stanno in localStorage come la larghezza della sidebar:
// è stato di questa finestra, non della libreria.
const LS_COLLAPSED = 'libraryFoldersCollapsed'
const collapsedFolders = reactive(new Set(JSON.parse(localStorage[LS_COLLAPSED] || '[]')))
function toggleFolder(id) {
  if (collapsedFolders.has(id)) collapsedFolders.delete(id)
  else collapsedFolders.add(id)
  localStorage[LS_COLLAPSED] = JSON.stringify([...collapsedFolders])
}

// respectCollapse=false serve alla tendina "aggiungi a cartella" dell'editor,
// che deve elencare tutte le cartelle anche se il ramo è chiuso nell'albero.
function flattenFolders(respectCollapse) {
  const rows = []
  const walk = (parentId, depth) => {
    for (const f of library.childFolders(parentId)) {
      const children = library.childFolders(f.id)
      rows.push({ folder: f, depth, hasChildren: children.length > 0 })
      if (!respectCollapse || !collapsedFolders.has(f.id)) walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}
const folderRows = computed(() => flattenFolders(true))
const allFolderRows = computed(() => flattenFolders(false))

// Colore di partenza del selettore per una cartella che non ne ha ancora uno.
// Il colore scelto è un DATO salvato in index.json e applicato con :style, ma
// il valore PROPOSTO si legge da --accent del tema acceso invece di fissarlo:
// con un esadecimale cablato, su giorno e su notturno il picker proporrebbe
// l'ottone di candela, cioè un colore che in quel tema non esiste. Il fallback
// serve solo se --accent non è un #rrggbb, perché <input type="color"> non
// accetta altro.
function defaultFolderColor() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#c9922f'
}

// Un solo stato per volta fra creazione, rinomina e conferma di eliminazione:
// sono tre modi di modificare la stessa riga, e tenerli separati vorrebbe dire
// poterli aprire tutti insieme sulla stessa cartella.
const folderEdit = ref(null) // { mode:'create'|'rename'|'delete', id, name } | null
const folderMsg = ref(null)
let msgTimer = null
function showFolderMsg(msg) {
  folderMsg.value = msg
  clearTimeout(msgTimer)
  msgTimer = setTimeout(() => (folderMsg.value = null), 4000)
}
onBeforeUnmount(() => clearTimeout(msgTimer))

function startCreateFolder(parentId) {
  folderEdit.value = { mode: 'create', id: parentId || null, name: '' }
}
function startRenameFolder(f) {
  folderEdit.value = { mode: 'rename', id: f.id, name: f.name }
}
function askDeleteFolder(f) {
  folderEdit.value = { mode: 'delete', id: f.id, name: f.name }
}
function cancelFolderEdit() {
  folderEdit.value = null
}
async function commitFolderEdit() {
  const e = folderEdit.value
  if (!e) return
  const name = e.name.trim()
  if (!name) return cancelFolderEdit()
  if (e.mode === 'create') await library.createFolder(name, e.id)
  else await library.renameFolder(e.id, name)
  folderEdit.value = null
}
async function confirmDeleteFolder() {
  await library.deleteFolder(folderEdit.value.id)
  folderEdit.value = null
}

// ---- Trascinamenti sull'albero ----
// Una traccia trascinata su una cartella ci viene AGGIUNTA, non spostata: una
// traccia può stare in più campagne insieme, e "sposta" implicherebbe toglierla
// da dove sta già. Il tipo application/x-track-id è lo stesso che legge la
// griglia di EditMode: la stessa traccia si trascina sui bottoni o qui.
//
// Cartella evidenziata sotto il puntatore: 'root' e non null perché "nessun
// bersaglio" e "la radice" sono due cose diverse da disegnare.
const dropTarget = ref(null)
const TRACK_TYPE = 'application/x-track-id'
const FOLDER_TYPE = 'application/x-folder-id'
function onFolderDragOver(e, folderId) {
  const types = [...e.dataTransfer.types]
  const track = types.includes(TRACK_TYPE)
  const folder = types.includes(FOLDER_TYPE)
  // Sulla radice ("tutta la libreria") si possono lasciare solo cartelle:
  // una traccia non appartiene a niente per definizione
  if (!folder && (!track || folderId === null)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = folder ? 'move' : 'copy'
  dropTarget.value = folderId || 'root'
}
async function onFolderDrop(e, folderId) {
  dropTarget.value = null
  const trackId = e.dataTransfer.getData(TRACK_TYPE)
  if (trackId && folderId) return library.addTrackToFolder(trackId, folderId)
  const movedId = e.dataTransfer.getData(FOLDER_TYPE)
  if (!movedId || movedId === folderId) return
  const ok = await library.moveFolder(movedId, folderId)
  if (!ok) showFolderMsg(t('library.folders.moveRefused'))
}
function onFolderDragStart(e, f) {
  e.dataTransfer.setData(FOLDER_TYPE, f.id)
  e.dataTransfer.effectAllowed = 'move'
}

// ---- Anteprima audio: un solo elemento condiviso, un solo player attivo ----
const previewId = ref(null)
let previewEl = null
function stopPreview() {
  if (previewEl) {
    previewEl.pause()
    previewEl.removeAttribute('src')
    previewEl.load()
    previewEl = null
  }
  previewId.value = null
}
function togglePreview(t) {
  if (previewId.value === t.id) return stopPreview()
  stopPreview()
  const el = new Audio(mediaUrl(t.audioPath))
  el.volume = t.volume ?? 1
  const stopIfCurrent = () => { if (previewEl === el) stopPreview() }
  el.onended = stopIfCurrent
  el.play().catch(stopIfCurrent)
  previewEl = el
  previewId.value = t.id
}
onBeforeUnmount(stopPreview)

// ---- Editor inline: rinomina + tag ----
// Un editor, uno stato: id, titolo, tag e tag in corso di digitazione nascono e
// muoiono insieme. Con quattro ref separate le regole di reset erano già
// divergenti — cancelEdit ne azzerava due su quattro, e salvare passava dal
// solito azzeramento due volte.
const edit = ref(null) // { id, title, tags, tagInput, folderIds } | null
function startEdit(t) {
  edit.value = {
    id: t.id,
    title: t.title,
    tags: t.tags ? [...t.tags] : [],
    tagInput: '',
    // Solo le cartelle che esistono davvero: un id orfano rimasto su una
    // traccia non deve tornare su disco solo perché si è aperto l'editor
    folderIds: library.trackFolderIds(t)
  }
}
function addEditFolder(e) {
  const id = e.target.value
  e.target.value = ''
  if (id && !edit.value.folderIds.includes(id)) edit.value.folderIds.push(id)
}
function removeEditFolder(id) {
  edit.value.folderIds = edit.value.folderIds.filter((f) => f !== id)
}
function cancelEdit() {
  edit.value = null
}
function addEditTag(raw) {
  const tag = raw.trim().toLowerCase()
  if (tag && !edit.value.tags.includes(tag)) edit.value.tags.push(tag)
}
// Il tag ancora nel campo di testo fa parte dell'editor tanto quanto i chip già
// creati: si consuma allo stesso modo con Invio, con la virgola e al salvataggio.
function commitTagInput() {
  addEditTag(edit.value.tagInput)
  edit.value.tagInput = ''
}
function onTagInputKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    commitTagInput()
  }
}
function removeEditTag(tag) {
  edit.value.tags = edit.value.tags.filter((tg) => tg !== tag)
}
function saveEdit(t) {
  commitTagInput()
  library.updateTrack(t.id, {
    title: edit.value.title.trim() || t.title,
    tags: edit.value.tags,
    folderIds: edit.value.folderIds
  })
  cancelEdit()
}

// ---- Zoom miniature: ciclo 28 -> 44 -> 64 -> 28 px, persistito ----
const THUMB_SIZES = [28, 44, 64]
const thumbSize = ref(Number(localStorage.libraryThumbSize) || 28)
function cycleThumbSize() {
  const i = THUMB_SIZES.indexOf(thumbSize.value)
  thumbSize.value = THUMB_SIZES[(i + 1) % THUMB_SIZES.length]
  localStorage.libraryThumbSize = thumbSize.value
}

// ---- Ridimensionamento sidebar: trascinamento del bordo destro ----
function clampWidth(w) {
  return Math.min(520, Math.max(200, w))
}
// Clamp anche in lettura: un valore fuori range (versione precedente con altri
// limiti, localStorage modificato a mano) non deve sopravvivere al riavvio.
const sidebarWidth = ref(clampWidth(Number(localStorage.librarySidebarWidth) || 260))
function onResizeStart(e) {
  e.preventDefault()
  const startX = e.clientX
  const startWidth = sidebarWidth.value
  const handle = e.currentTarget
  function onMove(ev) {
    sidebarWidth.value = clampWidth(startWidth + (ev.clientX - startX))
  }
  function onEnd() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
    localStorage.librarySidebarWidth = sidebarWidth.value
  }
  // Con la cattura del puntatore il drag termina anche se il mouse esce dalla
  // finestra: senza, quel pointerup si perde, i listener restano attaccati e la
  // sidebar continua a inseguire il mouse a pulsante rilasciato.
  try { handle.setPointerCapture(e.pointerId) } catch { /* browser senza capture */ }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onEnd)
}

// Download annullabili (in coda o in corso)
const pendingJobCount = computed(
  () => library.jobs.filter((j) => j.status !== 'error').length
)

// Sezioni richiudibili: con librerie grandi la lista è difficile da navigare
const collapsed = reactive({})
const toggleSection = (type) => (collapsed[type] = !collapsed[type])

// Mini-preview: thumbnail YouTube, o l'immagine stessa per i visual locali
const IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i
function trackThumb(t) {
  if (t.thumbnailPath) return mediaUrl(t.thumbnailPath)
  if (t.mediaPath && IMG_RE.test(t.mediaPath)) return mediaUrl(t.mediaPath)
  return null
}
// 🎬 video / 🖼️ immagine per distinguere i visual nella lista
function visualIcon(t) {
  if (t.type !== 'visual') return null
  return IMG_RE.test(t.mediaPath || '') ? '🖼️' : '🎬'
}

const PHASES = ['metadata', 'audio', 'video', 'convert', 'thumbnail']
// Tradotto ad ogni chiamata, non in una tabella a parte: una tabella costruita
// all'import resterebbe nella lingua di partenza dopo un cambio lingua.
function jobLabel(job) {
  if (job.status === 'error') return job.error
  return t(PHASES.includes(job.phase) ? `library.phase.${job.phase}` : 'library.phase.queued')
}
// Percentuale solo per le fasi audio/video; le altre sono indeterminate
function jobPct(job) {
  return job.status === 'active' && ['audio', 'video'].includes(job.phase) && job.percent != null
    ? Math.min(100, Math.round(job.percent))
    : null
}

const sections = ['music', 'ambience', 'oneshot', 'visual']

async function addYoutube(asVisual = false) {
  const text = ytUrl.value.trim()
  if (!text) return
  await library.addFromYoutubeBulk(text, { asVisual })
  ytUrl.value = ''
}

function onDragStart(e, track) {
  e.dataTransfer.setData('application/x-track-id', track.id)
  e.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="sidebar" :style="{ width: sidebarWidth + 'px' }">
    <div class="head-row">
      <h3>{{ $t('library.title') }}</h3>
      <button
        class="icon-btn thumb-zoom"
        :title="$t('library.thumbSize')"
        :aria-label="$t('library.thumbSize')"
        @click="cycleThumbSize"
      >🔍</button>
    </div>

    <input v-model="library.search" :placeholder="$t('library.searchPlaceholder')" class="search" />

    <div class="folders">
      <h4 class="folders-head">
        {{ $t('library.folders.title') }}
        <button
          class="row-btn"
          :title="$t('library.folders.new')"
          :aria-label="$t('library.folders.new')"
          @click="startCreateFolder(null)"
        >＋</button>
      </h4>
      <div class="folder-list">
        <div
          class="folder-row"
          :class="{ active: library.selectedFolderId === null, over: dropTarget === 'root' }"
          @click="library.selectFolder(null)"
          @dragover="onFolderDragOver($event, null)"
          @dragleave="dropTarget = null"
          @drop.prevent="onFolderDrop($event, null)"
        >
          <span class="chev" />
          <span class="folder-name">{{ $t('library.folders.all') }}</span>
          <span class="folder-count">{{ library.tracks.length }}</span>
        </div>

        <template v-for="row in folderRows" :key="row.folder.id">
          <div
            class="folder-row"
            :class="{ active: library.selectedFolderId === row.folder.id, over: dropTarget === row.folder.id }"
            :style="{ paddingLeft: 4 + row.depth * 12 + 'px' }"
            :draggable="folderEdit?.mode !== 'rename' || folderEdit.id !== row.folder.id"
            :title="$t('library.folders.dropHint', { name: row.folder.name })"
            @click="library.selectFolder(row.folder.id)"
            @dragstart.stop="onFolderDragStart($event, row.folder)"
            @dragover="onFolderDragOver($event, row.folder.id)"
            @dragleave="dropTarget = null"
            @drop.prevent="onFolderDrop($event, row.folder.id)"
          >
            <span
              class="chev"
              :title="collapsedFolders.has(row.folder.id) ? $t('library.folders.expand') : $t('library.folders.collapse')"
              @click.stop="row.hasChildren && toggleFolder(row.folder.id)"
            >{{ row.hasChildren ? (collapsedFolders.has(row.folder.id) ? '▸' : '▾') : '' }}</span>
            <span class="folder-dot" :style="row.folder.color ? { background: row.folder.color } : undefined" />
            <input
              v-if="folderEdit?.mode === 'rename' && folderEdit.id === row.folder.id"
              v-model="folderEdit.name"
              class="folder-input"
              :placeholder="$t('library.folders.namePlaceholder')"
              @click.stop
              @keydown.enter.prevent="commitFolderEdit"
              @keydown.esc.prevent="cancelFolderEdit"
              @blur="commitFolderEdit"
            />
            <span v-else class="folder-name">{{ row.folder.name }}</span>
            <span class="folder-actions" @click.stop>
              <input
                type="color"
                class="folder-color"
                :title="$t('library.folders.color')"
                :value="row.folder.color || defaultFolderColor()"
                @change="library.setFolderColor(row.folder.id, $event.target.value)"
              />
              <button class="row-btn" :title="$t('library.folders.newChild')" @click="startCreateFolder(row.folder.id)">＋</button>
              <button class="row-btn" :title="$t('library.folders.rename')" @click="startRenameFolder(row.folder)">✏️</button>
              <button class="row-btn" :title="$t('library.folders.delete')" @click="askDeleteFolder(row.folder)">🗑</button>
            </span>
            <span class="folder-count">{{ library.folderTrackCount(row.folder.id) }}</span>
          </div>
          <div
            v-if="folderEdit?.mode === 'delete' && folderEdit.id === row.folder.id"
            class="folder-confirm bulk-confirm"
          >
            <p class="bulk-msg">{{ $t('library.folders.deleteConfirm', { name: row.folder.name }) }}</p>
            <div class="bulk-btns">
              <button class="primary" @click="confirmDeleteFolder">{{ $t('library.folders.delete') }}</button>
              <button @click="cancelFolderEdit">{{ $t('library.cancel') }}</button>
            </div>
          </div>
          <input
            v-if="folderEdit?.mode === 'create' && folderEdit.id === row.folder.id"
            v-model="folderEdit.name"
            class="folder-input new-child"
            :style="{ marginLeft: 16 + row.depth * 12 + 'px' }"
            :placeholder="$t('library.folders.namePlaceholder')"
            @keydown.enter.prevent="commitFolderEdit"
            @keydown.esc.prevent="cancelFolderEdit"
            @blur="commitFolderEdit"
          />
        </template>

        <div
          class="folder-row"
          :class="{ active: library.selectedFolderId === UNFILED }"
          @click="library.selectFolder(UNFILED)"
        >
          <span class="chev" />
          <span class="folder-name">{{ $t('library.folders.unfiled') }}</span>
          <span class="folder-count">{{ library.unfiledCount }}</span>
        </div>

        <input
          v-if="folderEdit?.mode === 'create' && !folderEdit.id"
          v-model="folderEdit.name"
          class="folder-input"
          :placeholder="$t('library.folders.namePlaceholder')"
          @keydown.enter.prevent="commitFolderEdit"
          @keydown.esc.prevent="cancelFolderEdit"
          @blur="commitFolderEdit"
        />
        <p v-else-if="!library.folders.length" class="dim">{{ $t('library.folders.empty') }}</p>
      </div>
      <p v-if="folderMsg" class="error">{{ folderMsg }}</p>
    </div>

    <div v-if="filterTags.length" class="tag-mode" :title="$t('library.tagMatch.hint')">
      <span class="dim">{{ $t('library.tagMatch.label') }}</span>
      <button
        class="mode-btn"
        :class="{ active: library.tagMatchMode === 'all' }"
        @click="library.setTagMatchMode('all')"
      >{{ $t('library.tagMatch.all') }}</button>
      <button
        class="mode-btn"
        :class="{ active: library.tagMatchMode === 'any' }"
        @click="library.setTagMatchMode('any')"
      >{{ $t('library.tagMatch.any') }}</button>
    </div>
    <div v-if="filterTags.length" class="tag-filters">
      <span
        v-for="tag in filterTags"
        :key="tag"
        class="tag-chip"
        :class="{ active: library.tagFilter.includes(tag) }"
        @click="library.toggleTagFilter(tag)"
      >{{ tag }}</span>
    </div>

    <div class="import">
      <textarea
        v-model="ytUrl"
        class="yt-input"
        rows="2"
        :placeholder="$t('library.ytPlaceholder')"
        @keydown.enter.exact.prevent="addYoutube"
      />
      <div class="import-btns">
        <button
          class="primary icon-btn"
          :title="$t('library.downloadAudioTitle')"
          :aria-label="$t('library.downloadAudio')"
          @click="addYoutube(false)"
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        </button>
        <button
          class="icon-btn"
          :title="$t('library.downloadVideoTitle')"
          :aria-label="$t('library.downloadVideo')"
          @click="addYoutube(true)"
        >🎬</button>
      </div>
    </div>
    <p v-if="library.expanding" class="dim">{{ $t('library.expanding') }}</p>
    <div v-if="library.pendingBulk" class="bulk-confirm">
      <!-- i18n-t invece di $t: il conteggio va in grassetto, e la posizione del
           numero dentro la frase la decide la lingua, non il template. -->
      <i18n-t
        keypath="library.bulkAsk"
        scope="global"
        :plural="library.pendingBulk.entries.length"
        tag="p"
        class="bulk-msg"
      >
        <template #n><strong>{{ library.pendingBulk.entries.length }}</strong></template>
      </i18n-t>
      <div class="bulk-btns">
        <button class="primary" @click="library.confirmBulk()">{{ $t('library.bulkAll') }}</button>
        <button v-if="library.pendingBulk.single" @click="library.confirmBulk(true)">
          {{ $t('library.bulkSingle') }}
        </button>
        <button @click="library.cancelBulk()">{{ $t('library.cancel') }}</button>
      </div>
    </div>
    <div v-if="library.jobs.length" class="jobs">
      <button
        v-if="pendingJobCount > 1"
        class="cancel-all"
        @click="library.cancelAllJobs()"
      >{{ $t('library.cancelAll', pendingJobCount) }}</button>
      <div v-for="job in library.jobs" :key="job.id" class="job" :class="{ failed: job.status === 'error' }">
        <div class="job-row">
          <span class="job-title" :title="job.title">{{ job.title }}</span>
          <span v-if="jobPct(job) !== null" class="job-pct">{{ jobPct(job) }}%</span>
          <button
            class="job-dismiss"
            :title="job.status === 'error' ? $t('library.jobDismiss') : $t('library.jobCancel')"
            :aria-label="job.status === 'error' ? $t('library.jobDismiss') : $t('library.jobCancel')"
            @click="job.status === 'error' ? library.dismissJob(job.id) : library.cancelJob(job.id)"
          >×</button>
        </div>
        <span class="job-label" :class="{ 'job-error': job.status === 'error' }">{{ jobLabel(job) }}</span>
        <div v-if="job.status !== 'error'" class="dl-bar" :class="{ indeterminate: jobPct(job) === null }">
          <div
            class="dl-fill"
            :style="jobPct(job) !== null ? { width: jobPct(job) + '%' } : undefined"
          />
        </div>
      </div>
    </div>
    <button class="import-local" :disabled="library.importing" @click="library.importLocal()">
      {{ library.importing ? $t('library.importing') : $t('library.importAudio') }}
    </button>
    <button class="import-local" :disabled="library.importing" @click="library.importLocalVisual()">
      {{ library.importing ? $t('library.importing') : $t('library.importVisual') }}
    </button>
    <button
      v-if="library.missingDownloadable.length"
      class="import-local update-library"
      :disabled="library.downloading"
      @click="library.redownloadMissing()"
    >
      {{ $t('library.redownload', library.missingDownloadable.length) }}
    </button>
    <p v-if="library.missingLocal.length" class="local-missing">
      {{ $t('library.missingLocal', library.missingLocal.length) }}
    </p>
    <p v-if="library.error" class="error">{{ library.error }}</p>

    <div class="sections" :style="{ '--thumb': thumbSize + 'px' }">
      <section v-for="s in sections" :key="s">
        <h4 class="sec-head" @click="toggleSection(s)">
          <span class="chev">{{ collapsed[s] ? '▸' : '▾' }}</span>
          {{ $t(`library.sections.${s}`) }}
          <span class="sec-count">{{ library.byType(s).length }}</span>
        </h4>
        <template v-if="!collapsed[s]">
          <template v-for="t in library.byType(s)" :key="t.id">
            <div
              class="track"
              :class="{ missing: t.missing }"
              draggable="true"
              @dragstart="onDragStart($event, t)"
            >
              <img v-if="trackThumb(t)" :src="trackThumb(t)" class="mini-thumb" alt="" loading="lazy" />
              <span v-else class="type-dot" :class="t.type" />
              <span v-if="visualIcon(t)" class="visual-kind">{{ visualIcon(t) }}</span>
              <span
                class="title"
                :title="t.missing ? $t('library.trackMissing', { title: t.title }) : t.title"
              >
                {{ t.title }}
              </span>
              <span class="row-actions">
                <button
                  v-if="t.type !== 'visual' && !t.missing"
                  class="row-btn"
                  :title="previewId === t.id ? $t('library.previewStop') : $t('library.preview')"
                  @click.stop="togglePreview(t)"
                >{{ previewId === t.id ? '⏹' : '▶' }}</button>
                <button class="row-btn" :title="$t('library.renameTags')" @click.stop="startEdit(t)">✏️</button>
              </span>
              <span
                v-if="t.missing"
                class="missing-badge"
                :title="t.source?.type === 'youtube'
                  ? $t('library.missingYoutube')
                  : $t('library.missingLocalBadge')"
              >⚠</span>
            </div>
            <div v-if="edit?.id === t.id" class="editor bulk-confirm">
              <input v-model="edit.title" class="edit-title" :placeholder="$t('library.titlePlaceholder')" />
              <div class="edit-tags">
                <span v-for="tag in edit.tags" :key="tag" class="tag-chip editing">
                  {{ tag }}
                  <span class="tag-remove" @click="removeEditTag(tag)">×</span>
                </span>
                <input
                  v-model="edit.tagInput"
                  class="tag-input"
                  list="tag-suggestions"
                  :placeholder="$t('library.tagPlaceholder')"
                  @keydown="onTagInputKeydown"
                />
              </div>
              <!-- Le cartelle della traccia: qui si tolgono, dall'albero si
                   aggiungono anche col trascinamento. Una traccia può stare in
                   più cartelle, quindi sono chip e non una tendina sola. -->
              <div v-if="library.folders.length" class="edit-tags">
                <span v-for="fid in edit.folderIds" :key="fid" class="tag-chip editing">
                  {{ library.folderById(fid)?.name }}
                  <span
                    class="tag-remove"
                    :title="$t('library.folders.removeFrom')"
                    @click="removeEditFolder(fid)"
                  >×</span>
                </span>
                <select class="folder-add" @change="addEditFolder">
                  <option value="">{{ $t('library.folders.addTo') }}</option>
                  <option
                    v-for="row in allFolderRows"
                    :key="row.folder.id"
                    :value="row.folder.id"
                  >{{ '· '.repeat(row.depth) + row.folder.name }}</option>
                </select>
              </div>
              <div class="bulk-btns">
                <button class="primary" @click="saveEdit(t)">{{ $t('library.save') }}</button>
                <button @click="cancelEdit">{{ $t('library.cancel') }}</button>
              </div>
            </div>
          </template>
          <p v-if="!library.byType(s).length" class="dim">{{ $t('library.empty') }}</p>
        </template>
      </section>
    </div>

    <datalist id="tag-suggestions">
      <option v-for="tag in knownTags" :key="tag" :value="tag" />
    </datalist>

    <div class="resize-handle" @pointerdown="onResizeStart"></div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  position: relative; flex-shrink: 0;
}
h3 { margin: 0; font-size: 15px; }
h4 { margin: 8px 0 4px; font-size: 12px; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.6px; }
.head-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.thumb-zoom { width: 26px; height: 26px; font-size: 13px; }
.sec-head { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 4px; }
.sec-head:hover { color: var(--text); }
.chev { width: 12px; flex-shrink: 0; }
.sec-count { margin-left: auto; font-weight: 400; }
.mini-thumb {
  width: var(--thumb, 28px); height: var(--thumb, 28px); flex-shrink: 0;
  object-fit: cover; border-radius: 4px;
}
.tag-filters {
  display: flex; flex-wrap: wrap; gap: 4px;
  max-height: 72px; overflow-y: auto;
  font-size: 11px;
}
.tag-mode { display: flex; align-items: center; gap: 4px; font-size: 11px; }
.mode-btn {
  padding: 1px 6px; font-size: 11px;
  border-radius: 10px; border: 1px solid var(--border);
  background: var(--bg-raised); color: var(--text-dim);
  cursor: pointer;
}
.mode-btn.active { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
/* ---- Albero delle cartelle ---- */
.folders { display: flex; flex-direction: column; }
.folders-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
/* Tetto all'altezza: con dieci campagne l'albero spingerebbe fuori schermo la
   libreria vera, che è la parte che si usa di più */
.folder-list { max-height: 220px; overflow-y: auto; }
.folder-row {
  display: flex; align-items: center; gap: 4px;
  padding: 4px; border-radius: 6px;
  font-size: 13px; cursor: pointer; user-select: none;
}
.folder-row:hover { background: var(--hover); }
.folder-row.active { background: var(--accent); color: var(--on-accent); }
/* Bersaglio del trascinamento: deve leggersi anche sopra .active */
.folder-row.over { outline: 2px dashed var(--accent); outline-offset: -2px; }
.folder-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-count { flex-shrink: 0; font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.folder-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: var(--border);
}
/* A 200px di sidebar quattro icone e il nome non ci stanno: le azioni
   compaiono all'hover, come sulle righe delle tracce */
.folder-actions { display: flex; align-items: center; gap: 1px; flex-shrink: 0; visibility: hidden; }
.folder-row:hover .folder-actions { visibility: visible; }
.folder-color {
  width: 16px; height: 16px; padding: 0;
  border: none; background: none; cursor: pointer;
}
.folder-input { width: 100%; font-size: 12px; }
.folder-input.new-child { width: auto; }
.folder-confirm { margin: 4px 0; }
.folder-add { font-size: 11px; max-width: 100%; }
.tag-chip {
  padding: 2px 7px;
  border-radius: 10px;
  background: var(--bg-raised);
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.tag-chip.active { background: var(--accent); color: var(--on-accent); }
.tag-chip.editing {
  display: inline-flex; align-items: center; gap: 3px;
  cursor: default; background: var(--bg-panel); border: 1px solid var(--border);
}
.tag-remove { cursor: pointer; color: var(--text-dim); }
.tag-remove:hover { color: var(--danger); }
.visual-kind { flex-shrink: 0; font-size: 12px; }
.search { width: 100%; }
.import { display: flex; gap: 6px; align-items: stretch; }
.import-btns { display: flex; flex-direction: column; gap: 4px; }
.yt-input {
  flex: 1; min-width: 0;
  resize: vertical;
  font-family: inherit; font-size: 13px; line-height: 1.4;
}
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; width: 34px;
}
.bulk-confirm {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-raised);
}
.bulk-msg { margin: 0; font-size: 13px; }
.bulk-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.bulk-btns button { font-size: 12px; }
.cancel-all { font-size: 12px; color: var(--danger); }
.jobs { display: flex; flex-direction: column; gap: 8px; }
.job { display: flex; flex-direction: column; gap: 3px; }
.job-row {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 8px;
  font-size: 13px;
}
.job-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-pct { color: var(--text); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.job-dismiss {
  flex-shrink: 0; padding: 0 4px; line-height: 1;
  background: none; border: none; color: var(--text-dim); cursor: pointer;
}
.job-label {
  font-size: 11px; color: var(--text-dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.job-error { color: var(--danger); }
/* Il binario non può essere --bg-raised: sui temi chiari "sollevato" vuol dire
   bianco, e una barra bianca su un pannello quasi bianco non esiste. */
.dl-bar {
  height: 4px; border-radius: 2px; overflow: hidden;
  background: var(--sunken);
}
.dl-fill {
  height: 100%; border-radius: 2px;
  background: var(--accent);
  transition: width 0.2s;
}
.dl-bar.indeterminate .dl-fill {
  width: 35%;
  animation: slide 1.1s ease-in-out infinite;
}
@keyframes slide {
  from { margin-left: -35%; }
  to { margin-left: 100%; }
}
.import-local { font-size: 14px; }
.update-library { color: var(--ambience); }
.missing-badge { flex-shrink: 0; font-size: 12px; color: var(--danger); }
.local-missing { color: var(--danger); font-size: 12px; margin: 0; }
.error { color: var(--danger); font-size: 12px; margin: 0; }
/* min-height:0 annulla il min-height:auto di default dei flex item: senza,
   .sections si rifiuta di rimpicciolirsi sotto il suo contenuto e a traboccare
   è la .sidebar. Che scrolla — portandosi via .resize-handle, che è absolute
   rispetto al padding box e quindi scorre col contenuto invece di restare
   agganciata al bordo. */
.sections { flex: 1; min-height: 0; overflow-y: auto; }
.track {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: grab;
}
.track:hover { background: var(--hover); }
.track.missing { opacity: 0.5; }
.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.type-dot.music { background: var(--music); }
.type-dot.ambience { background: var(--ambience); }
.type-dot.oneshot { background: var(--oneshot); }
.type-dot.visual { background: var(--visual); }
.dim { color: var(--text-dim); font-size: 12px; margin: 2px 0; }
.row-actions {
  display: flex; gap: 2px; flex-shrink: 0;
  visibility: hidden;
}
.track:hover .row-actions { visibility: visible; }
.row-btn {
  background: none; border: none; cursor: pointer;
  padding: 0 2px; font-size: 12px; line-height: 1;
}
.editor {
  margin: 2px 8px 6px;
}
.edit-title { width: 100%; }
.edit-tags {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  font-size: 11px;
}
.tag-input { width: 70px; font-size: 11px; }
.resize-handle {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 6px; cursor: col-resize;
}
</style>
