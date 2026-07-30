<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue'
import { useLibraryStore, UNFILED } from '../stores/library'
import { useBoardsStore } from '../stores/boards'
import { trackThumb, visualIcon } from '../media'
import { previewId, stopPreview, togglePreview } from '../preview'
import { hiddenSelectionCount, rangeIds, visibleSelection } from '../selection'
import { rt, t, tm } from '../i18n'

const library = useLibraryStore()
const boards = useBoardsStore()

// ---- Apertura e chiusura ----
// <dialog> nativo con showModal(): la trappola del focus, l'inerzia di quello
// che sta dietro, il livello sopra ogni overflow e la chiusura con Esc le fa la
// piattaforma. Rifarle a mano voleva dire tre listener e un bug di focus per
// ognuna delle strade di chiusura.
const dlg = ref(null)
const searchEl = ref(null)
// Chromium riporta il focus da solo all'elemento che ha aperto il dialogo, ma
// solo se quell'elemento esiste ancora: lo teniamo comunque perché la sidebar
// intorno può ridisegnarsi mentre il dialogo è aperto (un download che finisce
// riordina la lista) e senza il ritorno esplicito il focus finirebbe su <body>,
// cioè fuori dalla portata della tastiera.
let opener = null
const isOpen = ref(false)

function open() {
  opener = document.activeElement
  // Il contenuto si monta solo da qui in avanti (v-if su .body). Un <dialog>
  // chiuso resta nel DOM: senza questo interruttore la griglia disegnava una
  // tessera e un <img> per OGNI traccia della libreria a dialogo chiuso, e li
  // ridisegnava a ogni cambio della libreria — su qualche centinaio di tracce
  // è lavoro speso per qualcosa che nessuno sta guardando.
  isOpen.value = true
  dlg.value.showModal()
  // A dialogo aperto la cosa più probabile è cercare: il focus va nella
  // ricerca, non sul primo bottone che capita nell'ordine del DOM.
  nextTick(() => searchEl.value?.focus())
}
function close() {
  dlg.value.close()
}
defineExpose({ open })

// Esc con la conferma di eliminazione aperta chiude la CONFERMA, non tutto:
// altrimenti un tasto solo fa sparire insieme la domanda e la selezione a cui
// si riferiva, e bisogna rifare tutto da capo per capire cosa si stava per
// togliere.
function onCancel(e) {
  if (!pendingDelete.value) return
  e.preventDefault()
  pendingDelete.value = null
}
function onClose() {
  isOpen.value = false
  // L'anteprima è un elemento condiviso con la sidebar: chiudere il dialogo
  // deve zittirlo, o resta a suonare una traccia che non si vede più.
  stopPreview()
  pendingDelete.value = null
  opener?.focus?.()
  opener = null
}
onBeforeUnmount(stopPreview)

// ---- Vista: griglia o tabella ----
// Il selettore cambia SOLO la densità: filtri, ricerca, ordinamento e selezione
// stanno fuori di qui e sopravvivono al passaggio. È la stessa libreria guardata
// da vicino o da lontano, non due schermate diverse.
const LS_VIEW = 'libraryDialogView'
const view = ref(localStorage[LS_VIEW] === 'table' ? 'table' : 'grid')
function setView(v) {
  view.value = v
  localStorage[LS_VIEW] = v
}

// ---- Ordinamento ----
// Nessuna colonna «durata»: le tracce non portano una durata. Né yt-dlp né
// l'import locale la scrivono in index.json, e ricavarla vorrebbe dire aprire
// e decodificare ogni file all'avvio. Una colonna sempre vuota è peggio di una
// colonna che non c'è.
const TYPE_ORDER = ['music', 'ambience', 'oneshot', 'visual']
const SORT_COLS = ['title', 'type', 'folders', 'tags']
const sortKey = ref('title')
const sortDir = ref(1)
function toggleSort(key) {
  if (sortKey.value === key) sortDir.value = -sortDir.value
  else {
    sortKey.value = key
    sortDir.value = 1
  }
}

function folderNames(track) {
  return library
    .trackFolderIds(track)
    .map((id) => library.folderById(id).name)
    .sort((a, b) => a.localeCompare(b))
}

const COMPARATORS = {
  title: (a, b) => a.title.localeCompare(b.title),
  // Per tipo si intende l'ordine delle sezioni della sidebar, non l'alfabeto:
  // è l'ordine con cui questa libreria si legge dappertutto.
  type: (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type),
  folders: (a, b) => folderNames(a).join(', ').localeCompare(folderNames(b).join(', ')),
  tags: (a, b) => (a.tags || []).join(', ').localeCompare((b.tags || []).join(', '))
}

// L'ordine è UNO per tutte e due le viste: la griglia mostra le stesse tracce
// nella stessa sequenza della tabella, così un intervallo con shift selezionato
// in una vista è lo stesso insieme visto nell'altra.
const sorted = computed(() => {
  const cmp = COMPARATORS[sortKey.value]
  const dir = sortDir.value
  // Titolo come spareggio: senza, quaranta tracce dello stesso tipo si
  // riordinano in modo diverso ad ogni ridisegno e la lista «balla».
  return [...library.filtered].sort((a, b) => cmp(a, b) * dir || a.title.localeCompare(b.title))
})
const orderedIds = computed(() => sorted.value.map((tr) => tr.id))

// ---- Selezione ----
const selected = reactive(new Set())
// Estremo fisso dell'intervallo con shift: l'ultima riga toccata senza shift.
const anchorId = ref(null)

const selectedVisible = computed(() => visibleSelection(selected, orderedIds.value))
const hiddenSelected = computed(() => hiddenSelectionCount(selected, orderedIds.value))
const allVisibleSelected = computed(
  () => sorted.value.length > 0 && selectedVisible.value.length === sorted.value.length
)

function onPick(e, id) {
  if (e.shiftKey && anchorId.value) {
    // Shift AGGIUNGE l'intervallo invece di sostituire la selezione: qui si
    // rastrellano tracce sparse per farne un gruppo, e una seconda passata che
    // cancella la prima costringerebbe a rifare tutto in un colpo solo.
    for (const rid of rangeIds(orderedIds.value, anchorId.value, id)) selected.add(rid)
    return
  }
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  anchorId.value = id
}
function toggleAllFiltered() {
  const ids = orderedIds.value
  if (allVisibleSelected.value) for (const id of ids) selected.delete(id)
  else for (const id of ids) selected.add(id)
  anchorId.value = null
}
function clearSelection() {
  selected.clear()
  anchorId.value = null
}

// ---- Azioni di gruppo ----
const bulkTag = ref('')
const bulkFolder = ref('')
const bulkType = ref('')
const bulkMsg = ref(null)
let msgTimer = null
function flash(msg) {
  bulkMsg.value = msg
  clearTimeout(msgTimer)
  msgTimer = setTimeout(() => (bulkMsg.value = null), 4000)
}
onBeforeUnmount(() => clearTimeout(msgTimer))

// Tutte le azioni lavorano su selectedVisible: mai sugli id nascosti dai
// filtri. Il numero scritto nella barra e il numero delle tracce toccate sono
// così sempre lo stesso.
async function runBulk(promise) {
  const n = await promise
  flash(n ? t('library.dialog.bulk.done', n) : t('library.dialog.bulk.noop'))
}
function addTag() {
  if (!bulkTag.value.trim()) return
  runBulk(library.bulkAddTag(selectedVisible.value, bulkTag.value))
}
function removeTag() {
  if (!bulkTag.value.trim()) return
  runBulk(library.bulkRemoveTag(selectedVisible.value, bulkTag.value))
}
function addFolder() {
  if (!bulkFolder.value) return
  runBulk(library.bulkAddToFolder(selectedVisible.value, bulkFolder.value))
}
function removeFolder() {
  if (!bulkFolder.value) return
  runBulk(library.bulkRemoveFromFolder(selectedVisible.value, bulkFolder.value))
}
function setType() {
  if (!bulkType.value) return
  runBulk(library.bulkSetType(selectedVisible.value, bulkType.value))
}

// ---- Eliminazione ----
// I conti si fanno UNA volta, all'apertura della conferma, e si congelano lì
// insieme agli id: se nel frattempo cambia un filtro, la domanda deve restare
// quella a cui l'utente sta rispondendo.
const pendingDelete = ref(null)
function askDelete() {
  const ids = selectedVisible.value
  if (!ids.length) return
  const builtin = library.builtinCount(ids)
  const removable = ids.filter((id) => !library.byId(id)?.builtin)
  pendingDelete.value = {
    ids,
    builtin,
    removable: removable.length,
    // I riferimenti si contano solo su quelle che spariranno davvero: le
    // builtin restano, e i loro bottoni continuano a funzionare.
    refs: boards.trackRefs(removable)
  }
}
async function confirmDelete() {
  const { ids } = pendingDelete.value
  pendingDelete.value = null
  if (previewId.value && ids.includes(previewId.value)) stopPreview()
  const n = await library.deleteTracks(ids)
  for (const id of ids) selected.delete(id)
  anchorId.value = null
  flash(n ? t('library.dialog.del.done', n) : t('library.dialog.del.nothing'))
}

// ---- Suggerimenti dei tag ----
// Come nell'editor inline: i suggeriti seguono la lingua, i tag già scritti
// sulle tracce restano quelli che sono.
const knownTags = computed(() => [
  ...new Set([...library.allTags, ...tm('library.tagSuggestions').map(rt)])
])

const AUDIO_TYPES = ['music', 'ambience', 'oneshot']
</script>

<template>
  <dialog ref="dlg" class="lib-dialog" @cancel="onCancel" @close="onClose">
    <!-- Tutto il contenuto vive solo a dialogo aperto: vedi il commento in open() -->
    <template v-if="isOpen">
    <header class="head">
      <h2>{{ $t('library.dialog.title') }}</h2>
      <input
        ref="searchEl"
        v-model="library.search"
        class="search"
        type="search"
        :placeholder="$t('library.searchPlaceholder')"
      />
      <div class="view-switch">
        <button
          :class="{ active: view === 'grid' }"
          :title="$t('library.dialog.view.gridTitle')"
          @click="setView('grid')"
        >{{ $t('library.dialog.view.grid') }}</button>
        <button
          :class="{ active: view === 'table' }"
          :title="$t('library.dialog.view.tableTitle')"
          @click="setView('table')"
        >{{ $t('library.dialog.view.table') }}</button>
      </div>
      <span class="count">{{ $t('library.dialog.count', sorted.length) }}</span>
      <button
        class="close"
        :title="$t('library.dialog.close')"
        :aria-label="$t('library.dialog.close')"
        @click="close"
      >✕</button>
    </header>

    <div class="body">
      <!-- Rail: gli stessi filtri della sidebar, letti dagli stessi getter
           dello store. Cambiarli qui li cambia anche là, perché il filtro è
           uno solo: tornare alla sidebar dopo aver cercato nel dialogo e
           trovarla ferma su un altro filtro sarebbe la stessa libreria in due
           stati diversi. -->
      <aside class="rail">
        <h3>{{ $t('library.folders.title') }}</h3>
        <div class="folder-list">
          <div
            class="folder-row"
            :class="{ active: library.selectedFolderId === null }"
            @click="library.selectFolder(null)"
          >
            <span class="folder-name">{{ $t('library.folders.all') }}</span>
            <span class="folder-count">{{ library.tracks.length }}</span>
          </div>
          <div
            v-for="row in library.flatFolders"
            :key="row.folder.id"
            class="folder-row"
            :class="{ active: library.selectedFolderId === row.folder.id }"
            :style="{ paddingLeft: 6 + row.depth * 12 + 'px' }"
            @click="library.selectFolder(row.folder.id)"
          >
            <span
              class="folder-dot"
              :style="row.folder.color ? { background: row.folder.color } : undefined"
            />
            <span class="folder-name">{{ row.folder.name }}</span>
            <span class="folder-count">{{ library.folderTrackCount(row.folder.id) }}</span>
          </div>
          <div
            class="folder-row"
            :class="{ active: library.selectedFolderId === UNFILED }"
            @click="library.selectFolder(UNFILED)"
          >
            <span class="folder-name">{{ $t('library.folders.unfiled') }}</span>
            <span class="folder-count">{{ library.unfiledCount }}</span>
          </div>
          <p v-if="!library.folders.length" class="dim">{{ $t('library.folders.empty') }}</p>
        </div>

        <h3>{{ $t('library.dialog.tagsTitle') }}</h3>
        <div v-if="library.filterTags.length" class="tag-mode" :title="$t('library.tagMatch.hint')">
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
        <div class="tag-filters">
          <span
            v-for="tag in library.filterTags"
            :key="tag"
            class="tag-chip"
            :class="{ active: library.tagFilter.includes(tag) }"
            @click="library.toggleTagFilter(tag)"
          >{{ tag }}</span>
        </div>
      </aside>

      <section class="main">
        <p v-if="!sorted.length" class="dim empty">{{ $t('library.dialog.noMatch') }}</p>

        <!-- Griglia: copertine grandi, per riconoscere una traccia senza
             leggere. Niente scroller virtuale: con qualche centinaio di
             tracce bastano loading="lazy" (le immagini fuori schermo non si
             scaricano nemmeno) e content-visibility sulle tessere (il browser
             salta layout e disegno di quelle non visibili). Un virtualizzatore
             porterebbe altezze da indovinare e la ricerca col tasto del
             browser che smette di trovare le righe. -->
        <div v-else-if="view === 'grid'" class="grid">
          <div
            v-for="tr in sorted"
            :key="tr.id"
            class="tile"
            :class="{ missing: tr.missing, picked: selected.has(tr.id) }"
            role="checkbox"
            tabindex="0"
            :aria-checked="selected.has(tr.id)"
            :aria-label="$t('library.dialog.selectTrack', { title: tr.title })"
            @click="onPick($event, tr.id)"
            @keydown.enter.prevent="onPick($event, tr.id)"
            @keydown.space.prevent="onPick($event, tr.id)"
          >
            <div class="cover">
              <img
                v-if="trackThumb(tr)"
                :src="trackThumb(tr)"
                alt=""
                loading="lazy"
                decoding="async"
              />
              <span v-else class="cover-dot" :class="tr.type" />
              <span v-if="visualIcon(tr)" class="visual-kind">{{ visualIcon(tr) }}</span>
              <span
                v-if="tr.missing"
                class="missing-badge"
                :title="tr.source?.type === 'youtube'
                  ? $t('library.missingYoutube')
                  : $t('library.missingLocalBadge')"
              >⚠</span>
              <button
                v-if="tr.type !== 'visual' && !tr.missing"
                class="preview-btn"
                :title="previewId === tr.id ? $t('library.previewStop') : $t('library.preview')"
                :aria-label="previewId === tr.id ? $t('library.previewStop') : $t('library.preview')"
                @click.stop="togglePreview(tr)"
              >{{ previewId === tr.id ? '⏹' : '▶' }}</button>
            </div>
            <div class="tile-title">
              <span class="type-dot" :class="tr.type" />
              <span
                class="tile-name"
                :title="tr.missing ? $t('library.trackMissing', { title: tr.title }) : tr.title"
              >{{ tr.title }}</span>
            </div>
            <div class="tile-meta">
              <span v-for="fid in library.trackFolderIds(tr)" :key="fid" class="folder-badge">
                {{ library.folderById(fid).name }}
              </span>
              <span v-for="tag in tr.tags || []" :key="tag" class="tag-chip small">{{ tag }}</span>
            </div>
          </div>
        </div>

        <!-- Tabella: la vista da fare fra una sessione e l'altra, con le
             spunte e le azioni di gruppo. -->
        <table v-else class="table">
          <thead>
            <tr>
              <th class="cb">
                <input
                  type="checkbox"
                  :checked="allVisibleSelected"
                  :indeterminate.prop="!allVisibleSelected && selectedVisible.length > 0"
                  :title="$t('library.dialog.selectAll')"
                  :aria-label="$t('library.dialog.selectAll')"
                  @change="toggleAllFiltered"
                />
              </th>
              <th
                v-for="col in SORT_COLS"
                :key="col"
                :class="col"
                :aria-sort="sortKey === col ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'"
              >
                <button
                  class="sort-btn"
                  :title="$t('library.dialog.sortBy', { col: $t(`library.dialog.col.${col}`) })"
                  @click="toggleSort(col)"
                >
                  {{ $t(`library.dialog.col.${col}`) }}
                  <span class="arrow">{{ sortKey === col ? (sortDir === 1 ? '▲' : '▼') : '' }}</span>
                </button>
              </th>
              <th class="actions" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="tr in sorted"
              :key="tr.id"
              :class="{ missing: tr.missing, picked: selected.has(tr.id) }"
              @click="onPick($event, tr.id)"
            >
              <td class="cb">
                <!-- Niente .prevent qui. Annullare l'attivazione nativa fa
                     rimettere a Chromium il .checked di prima DOPO che Vue ha
                     già riconciliato, e la casella resta a mostrare il
                     contrario dello stato vero: la barra diceva "4
                     selezionate" con due caselle vuote, cioè l'unica cosa che
                     non si può lasciare ambigua davanti a "Togli dalla
                     libreria". Lasciando togglare il browser, la casella e lo
                     store concordano già da soli nel caso normale, e quando
                     l'intervallo shift decide altrimenti ci pensa il binding
                     :checked. -->
                <input
                  type="checkbox"
                  :checked="selected.has(tr.id)"
                  :aria-label="$t('library.dialog.selectTrack', { title: tr.title })"
                  @click.stop="onPick($event, tr.id)"
                />
              </td>
              <td class="title">
                <img
                  v-if="trackThumb(tr)"
                  :src="trackThumb(tr)"
                  class="row-thumb"
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span v-else class="type-dot" :class="tr.type" />
                <span class="cell-text">{{ tr.title }}</span>
                <span
                  v-if="tr.missing"
                  class="missing-badge"
                  :title="tr.source?.type === 'youtube'
                    ? $t('library.missingYoutube')
                    : $t('library.missingLocalBadge')"
                >⚠</span>
              </td>
              <td class="type">
                <span class="type-dot" :class="tr.type" />
                {{ $t(`library.sections.${tr.type}`) }}
              </td>
              <td class="folders">
                <span v-if="!library.trackFolderIds(tr).length" class="dim">
                  {{ $t('library.dialog.none') }}
                </span>
                <span v-for="fid in library.trackFolderIds(tr)" :key="fid" class="folder-badge">
                  {{ library.folderById(fid).name }}
                </span>
              </td>
              <td class="tags">
                <span v-if="!(tr.tags || []).length" class="dim">
                  {{ $t('library.dialog.none') }}
                </span>
                <span v-for="tag in tr.tags || []" :key="tag" class="tag-chip small">{{ tag }}</span>
              </td>
              <td class="actions">
                <button
                  v-if="tr.type !== 'visual' && !tr.missing"
                  class="row-btn"
                  :title="previewId === tr.id ? $t('library.previewStop') : $t('library.preview')"
                  :aria-label="previewId === tr.id ? $t('library.previewStop') : $t('library.preview')"
                  @click.stop="togglePreview(tr)"
                >{{ previewId === tr.id ? '⏹' : '▶' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Conferma di eliminazione: sopra la barra, non in un secondo dialogo.
         Un <dialog> dentro un <dialog> ruberebbe il focus al primo e su Esc
         chiuderebbe quello sbagliato. -->
    <div v-if="pendingDelete" class="confirm">
      <p class="confirm-ask">{{ $t('library.dialog.del.ask', pendingDelete.removable) }}</p>
      <p class="confirm-note">{{ $t('library.dialog.del.files') }}</p>
      <p v-if="pendingDelete.refs.buttons" class="confirm-warn">
        {{ $t('library.dialog.del.refs', {
          buttons: $t('library.dialog.del.refsButtons', pendingDelete.refs.buttons),
          boards: $t('library.dialog.del.refsBoards', pendingDelete.refs.boards)
        }) }}
      </p>
      <p v-if="pendingDelete.builtin" class="confirm-note">
        {{ $t('library.dialog.del.builtin', pendingDelete.builtin) }}
      </p>
      <div class="confirm-btns">
        <button
          v-if="pendingDelete.removable"
          class="danger"
          @click="confirmDelete"
        >{{ $t('library.dialog.del.confirm') }}</button>
        <span v-else class="dim">{{ $t('library.dialog.del.nothing') }}</span>
        <button @click="pendingDelete = null">{{ $t('library.cancel') }}</button>
      </div>
    </div>

    <footer v-if="selectedVisible.length" class="bulk">
      <span class="bulk-count">{{ $t('library.dialog.selected', selectedVisible.length) }}</span>
      <span v-if="hiddenSelected" class="dim">
        {{ $t('library.dialog.hiddenSelected', hiddenSelected) }}
      </span>
      <button :title="$t('library.dialog.clear')" @click="clearSelection">
        {{ $t('library.dialog.clear') }}
      </button>

      <span class="sep" />

      <input
        v-model="bulkTag"
        class="bulk-tag"
        list="dialog-tag-suggestions"
        :placeholder="$t('library.dialog.bulk.tagPlaceholder')"
        @keydown.enter.prevent="addTag"
      />
      <button :title="$t('library.dialog.bulk.addTagTitle')" @click="addTag">
        {{ $t('library.dialog.bulk.addTag') }}
      </button>
      <button :title="$t('library.dialog.bulk.removeTagTitle')" @click="removeTag">
        {{ $t('library.dialog.bulk.removeTag') }}
      </button>

      <select v-if="library.folders.length" v-model="bulkFolder" class="bulk-folder">
        <option value="">{{ $t('library.dialog.bulk.folderPlaceholder') }}</option>
        <option v-for="row in library.flatFolders" :key="row.folder.id" :value="row.folder.id">
          {{ '· '.repeat(row.depth) + row.folder.name }}
        </option>
      </select>
      <button
        v-if="library.folders.length"
        :title="$t('library.dialog.bulk.addFolderTitle')"
        @click="addFolder"
      >{{ $t('library.dialog.bulk.addFolder') }}</button>
      <button
        v-if="library.folders.length"
        :title="$t('library.dialog.bulk.removeFolderTitle')"
        @click="removeFolder"
      >{{ $t('library.dialog.bulk.removeFolder') }}</button>

      <select v-model="bulkType" class="bulk-type">
        <option value="">{{ $t('library.dialog.bulk.typePlaceholder') }}</option>
        <option v-for="ty in AUDIO_TYPES" :key="ty" :value="ty">
          {{ $t(`library.sections.${ty}`) }}
        </option>
      </select>
      <button :title="$t('library.dialog.bulk.setTypeTitle')" @click="setType">
        {{ $t('library.dialog.bulk.setType') }}
      </button>

      <span class="sep" />

      <button class="danger" :title="$t('library.dialog.bulk.deleteTitle')" @click="askDelete">
        {{ $t('library.dialog.bulk.delete') }}
      </button>
      <span v-if="bulkMsg" class="bulk-msg">{{ bulkMsg }}</span>
    </footer>

    <datalist id="dialog-tag-suggestions">
      <option v-for="tag in knownTags" :key="tag" :value="tag" />
    </datalist>
    </template>
  </dialog>
</template>

<style scoped>
.lib-dialog {
  width: min(1280px, 94vw);
  height: min(860px, 90vh);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
  color: var(--text);
  overflow: hidden;
}
.lib-dialog[open] { display: flex; flex-direction: column; }
/* ::backdrop eredita le variabili dalla radice, quindi il velo è il fondo del
   tema e non un nero fisso: su «giorno» un nero al 50% farebbe sembrare
   l'applicazione spenta invece che dietro a una finestra. */
.lib-dialog::backdrop { background: color-mix(in srgb, var(--bg) 72%, transparent); }

.head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.head h2 { margin: 0; font-size: 16px; }
.head .search { flex: 1; min-width: 120px; max-width: 420px; }
.count { color: var(--text-dim); font-size: 13px; font-variant-numeric: tabular-nums; }
.close { padding: 6px 12px; }
.view-switch { display: flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.view-switch button { border: none; border-radius: 0; font-size: 14px; padding: 8px 14px; }
.view-switch button.active { background: var(--accent); color: var(--on-accent); }

.body { flex: 1; min-height: 0; display: flex; }
.rail {
  width: 230px; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.rail h3 {
  margin: 8px 0 2px; font-size: 12px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-dim);
}
.folder-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 6px; border-radius: 6px;
  font-size: 13px; cursor: pointer;
}
.folder-row:hover { background: var(--hover); }
.folder-row.active { background: var(--accent); color: var(--on-accent); }
.folder-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-count { font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.folder-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--border); }
.tag-mode { display: flex; align-items: center; gap: 4px; font-size: 11px; }
.mode-btn {
  padding: 1px 6px; font-size: 11px;
  border-radius: 10px; border: 1px solid var(--border);
  background: var(--bg-raised); color: var(--text-dim);
}
.mode-btn.active { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.tag-filters { display: flex; flex-wrap: wrap; gap: 4px; font-size: 11px; }
.tag-chip {
  padding: 2px 7px; border-radius: 10px;
  background: var(--bg-raised); color: var(--text-dim);
  cursor: pointer; user-select: none; white-space: nowrap;
}
.tag-chip.active { background: var(--accent); color: var(--on-accent); }
.tag-chip.small { cursor: inherit; font-size: 11px; }

.main { flex: 1; min-width: 0; overflow: auto; padding: 12px; }
.empty { display: grid; place-items: center; height: 100%; }

/* ---- Griglia ---- */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
}
.tile {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-raised);
  cursor: pointer;
  /* Il browser salta layout e disegno delle tessere fuori dallo schermo; la
     dimensione dichiarata evita che la barra di scorrimento salti mentre si
     scende. Con qualche centinaio di copertine è la differenza fra scorrere
     liscio e scorrere a scatti. */
  content-visibility: auto;
  contain-intrinsic-size: auto 210px;
}
.tile:hover { border-color: var(--text-dim); }
.tile.picked { border-color: var(--accent); outline: 1px solid var(--accent); }
.tile.missing { opacity: 0.55; }
.cover {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 6px; overflow: hidden;
  background: var(--sunken);
  display: grid; place-items: center;
}
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-dot { width: 26px; height: 26px; border-radius: 50%; }
.visual-kind { position: absolute; top: 4px; left: 5px; font-size: 13px; }
.preview-btn {
  position: absolute; right: 5px; bottom: 5px;
  padding: 4px 9px; font-size: 12px; line-height: 1;
  visibility: hidden;
}
/* L'anteprima compare al passaggio del mouse, come sulle righe della sidebar.
   Volutamente un bottone e non l'avvio automatico all'hover: passare sopra la
   griglia cercando una traccia non deve far partire audio al tavolo. */
.tile:hover .preview-btn, .tile:focus-within .preview-btn { visibility: visible; }
.tile-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tile-name {
  font-size: 13px; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.tile-meta { display: flex; flex-wrap: wrap; gap: 3px; font-size: 11px; }
.type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.type-dot.music, .cover-dot.music { background: var(--music); }
.type-dot.ambience, .cover-dot.ambience { background: var(--ambience); }
.type-dot.oneshot, .cover-dot.oneshot { background: var(--oneshot); }
.type-dot.visual, .cover-dot.visual { background: var(--visual); }
.folder-badge {
  padding: 1px 6px; border-radius: 6px;
  border: 1px solid var(--border); color: var(--text-dim);
  white-space: nowrap;
}

/* ---- Tabella ---- */
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { text-align: left; padding: 0; border-bottom: 1px solid var(--border); }
.table th.cb, .table td.cb { width: 34px; text-align: center; }
.table th.actions, .table td.actions { width: 40px; }
.sort-btn {
  width: 100%; text-align: left;
  padding: 8px 6px; font-size: 12px;
  background: none; border: none; border-radius: 0;
  color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px;
}
.sort-btn:hover { color: var(--text); }
.arrow { font-size: 9px; }
.table td { padding: 5px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.table tbody tr { cursor: pointer; }
.table tbody tr:hover { background: var(--hover); }
.table tbody tr.picked { background: color-mix(in srgb, var(--accent) 22%, transparent); }
.table tbody tr.missing { opacity: 0.55; }
.table td.title { display: flex; align-items: center; gap: 8px; }
.row-thumb { width: 40px; height: 24px; object-fit: cover; border-radius: 3px; flex-shrink: 0; }
.cell-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.table td.folders, .table td.tags { display: table-cell; }
.table td.folders span, .table td.tags span { margin-right: 3px; }
.row-btn { background: none; border: none; padding: 2px 4px; font-size: 12px; }

/* ---- Conferma ed azioni di gruppo ---- */
.confirm {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-raised);
  flex-shrink: 0;
}
.confirm p { margin: 0; font-size: 13px; }
.confirm-ask { font-weight: 600; }
.confirm-note { color: var(--text-dim); }
.confirm-warn { color: var(--danger); }
.confirm-btns { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.bulk {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-raised);
  flex-shrink: 0;
}
.bulk button { padding: 6px 10px; font-size: 13px; }
.bulk input, .bulk select { padding: 6px 8px; font-size: 13px; }
.bulk-count { font-weight: 600; font-size: 13px; }
.bulk-tag { width: 110px; }
.bulk-folder, .bulk-type { max-width: 170px; }
.sep { width: 1px; align-self: stretch; background: var(--border); }
.bulk-msg { color: var(--text-dim); font-size: 12px; }
.dim { color: var(--text-dim); font-size: 12px; margin: 2px 0; }
</style>
