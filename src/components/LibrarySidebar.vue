<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { TAG_SUGGESTIONS, useLibraryStore } from '../stores/library'
import { mediaUrl } from '../media'

const library = useLibraryStore()
const ytUrl = ref('')

// Tutti i tag noti (usati + suggeriti), per il datalist dell'editor inline
const knownTags = computed(() => [...new Set([...library.allTags, ...TAG_SUGGESTIONS])])

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
const editingId = ref(null)
const editTitle = ref('')
const editTags = ref([])
const tagInput = ref('')
function startEdit(t) {
  editingId.value = t.id
  editTitle.value = t.title
  editTags.value = t.tags ? [...t.tags] : []
  tagInput.value = ''
}
function cancelEdit() {
  editingId.value = null
  tagInput.value = ''
}
function addEditTag(raw) {
  const tag = raw.trim().toLowerCase()
  if (tag && !editTags.value.includes(tag)) editTags.value.push(tag)
}
function onTagInputKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    addEditTag(tagInput.value)
    tagInput.value = ''
  }
}
function removeEditTag(tag) {
  editTags.value = editTags.value.filter((tg) => tg !== tag)
}
function saveEdit(t) {
  if (tagInput.value.trim()) {
    addEditTag(tagInput.value)
    tagInput.value = ''
  }
  library.updateTrack(t.id, { title: editTitle.value.trim() || t.title, tags: editTags.value })
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
const sidebarWidth = ref(Number(localStorage.librarySidebarWidth) || 260)
function clampWidth(w) {
  return Math.min(520, Math.max(200, w))
}
function onResizeStart(e) {
  e.preventDefault()
  const startX = e.clientX
  const startWidth = sidebarWidth.value
  function onMove(ev) {
    sidebarWidth.value = clampWidth(startWidth + (ev.clientX - startX))
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    localStorage.librarySidebarWidth = sidebarWidth.value
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
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

const phaseLabels = {
  metadata: 'Recupero informazioni…',
  audio: 'Download audio…',
  video: 'Download video…',
  convert: 'Conversione…',
  thumbnail: 'Download copertina…'
}
function jobLabel(job) {
  if (job.status === 'error') return job.error
  return phaseLabels[job.phase] || 'In coda…'
}
// Percentuale solo per le fasi audio/video; le altre sono indeterminate
function jobPct(job) {
  return job.status === 'active' && ['audio', 'video'].includes(job.phase) && job.percent != null
    ? Math.min(100, Math.round(job.percent))
    : null
}

const sections = [
  { type: 'music', label: 'Musica' },
  { type: 'ambience', label: 'Ambience' },
  { type: 'oneshot', label: 'One-Shot' },
  { type: 'visual', label: 'Visual (cast)' }
]

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
      <h3>Libreria</h3>
      <button
        class="icon-btn thumb-zoom"
        title="Dimensione miniature"
        aria-label="Dimensione miniature"
        @click="cycleThumbSize"
      >🔍</button>
    </div>

    <input v-model="library.search" placeholder="Cerca per nome o tag..." class="search" />

    <div v-if="library.allTags.length" class="tag-filters">
      <span
        v-for="tag in library.allTags"
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
        placeholder="URL o playlist YouTube"
        @keydown.enter.exact.prevent="addYoutube"
      />
      <div class="import-btns">
        <button
          class="primary icon-btn"
          title="Scarica audio da YouTube (una o più righe, anche playlist)"
          aria-label="Scarica audio da YouTube"
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
          title="Scarica VIDEO da YouTube (mp4, per il cast su Chromecast)"
          aria-label="Scarica video da YouTube"
          @click="addYoutube(true)"
        >🎬</button>
      </div>
    </div>
    <p v-if="library.expanding" class="dim">Lettura playlist…</p>
    <div v-if="library.pendingBulk" class="bulk-confirm">
      <p class="bulk-msg">
        La playlist contiene <strong>{{ library.pendingBulk.entries.length }}</strong> video.
        Scaricarli tutti?
      </p>
      <div class="bulk-btns">
        <button class="primary" @click="library.confirmBulk()">Scarica tutti</button>
        <button v-if="library.pendingBulk.single" @click="library.confirmBulk(true)">
          Solo questo video
        </button>
        <button @click="library.cancelBulk()">Annulla</button>
      </div>
    </div>
    <div v-if="library.jobs.length" class="jobs">
      <button
        v-if="pendingJobCount > 1"
        class="cancel-all"
        @click="library.cancelAllJobs()"
      >✕ Annulla tutti i download ({{ pendingJobCount }})</button>
      <div v-for="job in library.jobs" :key="job.id" class="job" :class="{ failed: job.status === 'error' }">
        <div class="job-row">
          <span class="job-title" :title="job.title">{{ job.title }}</span>
          <span v-if="jobPct(job) !== null" class="job-pct">{{ jobPct(job) }}%</span>
          <button
            class="job-dismiss"
            :title="job.status === 'error' ? 'Rimuovi' : 'Annulla download'"
            :aria-label="job.status === 'error' ? 'Rimuovi' : 'Annulla download'"
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
      {{ library.importing ? '⏳ Importazione…' : '+ Importa audio locale' }}
    </button>
    <button class="import-local" :disabled="library.importing" @click="library.importLocalVisual()">
      {{ library.importing ? '⏳ Importazione…' : '+ Importa immagine/video' }}
    </button>
    <button
      v-if="library.missingDownloadable.length"
      class="import-local update-library"
      :disabled="library.downloading"
      @click="library.redownloadMissing()"
    >
      ⟳ Scarica {{ library.missingDownloadable.length }} file mancanti
    </button>
    <p v-if="library.missingLocal.length" class="local-missing">
      ⚠ {{ library.missingLocal.length }}
      {{ library.missingLocal.length === 1 ? 'file locale mancante' : 'file locali mancanti' }}:
      nessun URL sorgente, reimportali manualmente
    </p>
    <p v-if="library.error" class="error">{{ library.error }}</p>

    <div class="sections" :style="{ '--thumb': thumbSize + 'px' }">
      <section v-for="s in sections" :key="s.type">
        <h4 class="sec-head" @click="toggleSection(s.type)">
          <span class="chev">{{ collapsed[s.type] ? '▸' : '▾' }}</span>
          {{ s.label }}
          <span class="sec-count">{{ library.byType(s.type).length }}</span>
        </h4>
        <template v-if="!collapsed[s.type]">
          <template v-for="t in library.byType(s.type)" :key="t.id">
            <div
              class="track"
              :class="{ missing: t.missing }"
              draggable="true"
              @dragstart="onDragStart($event, t)"
            >
              <img v-if="trackThumb(t)" :src="trackThumb(t)" class="mini-thumb" alt="" loading="lazy" />
              <span v-else class="type-dot" :class="t.type" />
              <span v-if="visualIcon(t)" class="visual-kind">{{ visualIcon(t) }}</span>
              <span class="title" :title="t.missing ? `${t.title} (file mancante)` : t.title">
                {{ t.title }}
              </span>
              <span class="row-actions">
                <button
                  v-if="t.type !== 'visual' && !t.missing"
                  class="row-btn"
                  :title="previewId === t.id ? 'Ferma anteprima' : 'Anteprima'"
                  @click.stop="togglePreview(t)"
                >{{ previewId === t.id ? '⏹' : '▶' }}</button>
                <button class="row-btn" title="Rinomina / tag" @click.stop="startEdit(t)">✏️</button>
              </span>
              <span
                v-if="t.missing"
                class="missing-badge"
                :title="t.source?.type === 'youtube'
                  ? 'File mancante: verrà ri-scaricato da YouTube'
                  : 'File locale mancante: reimportalo manualmente'"
              >⚠</span>
            </div>
            <div v-if="editingId === t.id" class="editor bulk-confirm">
              <input v-model="editTitle" class="edit-title" placeholder="Titolo" />
              <div class="edit-tags">
                <span v-for="tag in editTags" :key="tag" class="tag-chip editing">
                  {{ tag }}
                  <span class="tag-remove" @click="removeEditTag(tag)">×</span>
                </span>
                <input
                  v-model="tagInput"
                  class="tag-input"
                  list="tag-suggestions"
                  placeholder="+ tag"
                  @keydown="onTagInputKeydown"
                />
              </div>
              <div class="bulk-btns">
                <button class="primary" @click="saveEdit(t)">Salva</button>
                <button @click="cancelEdit">Annulla</button>
              </div>
            </div>
          </template>
          <p v-if="!library.byType(s.type).length" class="dim">Vuoto</p>
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
.tag-chip {
  padding: 2px 7px;
  border-radius: 10px;
  background: var(--bg-raised);
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.tag-chip.active { background: var(--music); color: #fff; }
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
.dl-bar {
  height: 4px; border-radius: 2px; overflow: hidden;
  background: var(--bg-raised);
}
.dl-fill {
  height: 100%; border-radius: 2px;
  background: var(--music);
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
.sections { flex: 1; overflow-y: auto; }
.track {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: grab;
}
.track:hover { background: var(--bg-raised); }
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
