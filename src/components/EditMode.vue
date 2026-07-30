<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useBoardsStore } from '../stores/boards'
import { useLibraryStore } from '../stores/library'
import { usePlaybackStore } from '../stores/playback'
import { cellFromPoint, clampToBounds, fits, nearestFree, occupancy, resizeBy, HANDLES } from '../grid'
import LibrarySidebar from './LibrarySidebar.vue'
import PropertiesPanel from './PropertiesPanel.vue'
import SoundButton from './SoundButton.vue'

const boards = useBoardsStore()
const library = useLibraryStore()
const playback = usePlaybackStore()

const gridEl = ref(null)

// Il rettangolo delle CELLE, non quello dell'elemento: la griglia ha 12px di
// padding, e contarlo fra le celle sposta il bersaglio di mezza cella vicino
// ai bordi. Era il motivo per cui i rilasci lungo il bordo finivano una cella
// più in là di dove si era mirato.
function contentRect(el) {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const l = parseFloat(cs.paddingLeft)
  const t = parseFloat(cs.paddingTop)
  return {
    left: r.left + l,
    top: r.top + t,
    width: el.clientWidth - l - parseFloat(cs.paddingRight),
    height: el.clientHeight - t - parseFloat(cs.paddingBottom)
  }
}

// ---- Trascinamento con i Pointer Events ----
// Non più il drag nativo HTML5: quello disegna il fantasma del browser (una
// fotografia semitrasparente del nodo, che non si aggancia a niente), non dice
// mai dove il bottone finirà davvero, e non esiste su touch e penna. Qui il
// fantasma è un figlio della griglia, quindi cade esattamente sulle celle, e
// dice PRIMA del rilascio se quel posto è libero.
//
// drag = { kind, id, handle, start, origin, cell, preview, valid }
const drag = ref(null)

const cellSize = () => {
  const r = contentRect(gridEl.value)
  return { w: r.width / boards.current.cols, h: r.height / boards.current.rows }
}

function beginMove(e, btn) {
  if (e.button !== 0) return
  boards.selectedButtonId = btn.id
  const r = contentRect(gridEl.value)
  drag.value = {
    kind: 'move',
    id: btn.id,
    handle: null,
    start: { row: btn.row, col: btn.col, rowSpan: btn.rowSpan, colSpan: btn.colSpan },
    // Da quale cella del bottone si è preso: trascinando dal suo angolo destro
    // il bottone non deve saltare col suo angolo sinistro sotto il puntatore.
    grab: cellFromPoint(r, boards.current.cols, boards.current.rows, e.clientX, e.clientY),
    origin: { x: e.clientX, y: e.clientY },
    preview: { row: btn.row, col: btn.col, rowSpan: btn.rowSpan, colSpan: btn.colSpan },
    valid: true
  }
  capture(e)
}

function beginResize(e, btn, handle) {
  if (e.button !== 0) return
  e.stopPropagation()
  boards.selectedButtonId = btn.id
  drag.value = {
    kind: 'resize',
    id: btn.id,
    handle,
    start: { row: btn.row, col: btn.col, rowSpan: btn.rowSpan, colSpan: btn.colSpan },
    grab: null,
    origin: { x: e.clientX, y: e.clientY },
    preview: { row: btn.row, col: btn.col, rowSpan: btn.rowSpan, colSpan: btn.colSpan },
    valid: true
  }
  capture(e)
}

// Con la cattura del puntatore il gesto finisce anche se il dito esce dalla
// finestra: senza, quel pointerup si perde e il fantasma resta appeso al
// puntatore a pulsante già rilasciato.
function capture(e) {
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* niente capture */ }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onCancel)
}
function release() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onEnd)
  window.removeEventListener('pointercancel', onCancel)
}

function onMove(e) {
  const d = drag.value
  if (!d) return
  const b = boards.current
  const occupied = occupancy(b.buttons, d.id)
  let next

  if (d.kind === 'move') {
    const r = contentRect(gridEl.value)
    const now = cellFromPoint(r, b.cols, b.rows, e.clientX, e.clientY)
    // Si muove di quanto si è spostata la CELLA sotto il dito, non di quanto
    // si è spostato il dito: così il punto di presa resta lo stesso.
    next = clampToBounds({
      row: d.start.row + (now.row - d.grab.row),
      col: d.start.col + (now.col - d.grab.col),
      rowSpan: d.start.rowSpan,
      colSpan: d.start.colSpan
    }, b.cols, b.rows)
  } else {
    const { w, h } = cellSize()
    const dc = Math.round((e.clientX - d.origin.x) / w)
    const dr = Math.round((e.clientY - d.origin.y) / h)
    next = resizeBy(d.start, d.handle, dr, dc)
  }

  d.preview = next
  d.valid = fits(next, b.cols, b.rows, occupied)
}

async function onEnd() {
  const d = drag.value
  release()
  drag.value = null
  if (!d) return
  const same =
    d.preview.row === d.start.row && d.preview.col === d.start.col &&
    d.preview.rowSpan === d.start.rowSpan && d.preview.colSpan === d.start.colSpan
  // Rilascio su celle occupate: si rifiuta e il bottone torna dov'era. Meglio
  // un gesto che non fa niente di due bottoni impilati, dove quello sotto
  // tiene le sue celle e non si riesce più a selezionare.
  if (same || !d.valid) return
  await boards.updateButton(d.id, d.preview)
}

function onCancel() {
  release()
  drag.value = null
}
onBeforeUnmount(release)

// ---- Rilascio di una traccia dalla libreria ----
// Questa strada resta sul drag nativo: attraversa due componenti e la sidebar
// la usa anche per le cartelle. Il controllo di collisione però è lo stesso.
const dropPreview = ref(null)

function libraryTarget(e) {
  const b = boards.current
  const r = contentRect(gridEl.value)
  const cell = cellFromPoint(r, b.cols, b.rows, e.clientX, e.clientY)
  const span = { rowSpan: 1, colSpan: 2 }
  // Mirare esatto col drag nativo è difficile: se la cella puntata è presa si
  // propone la libera più vicina invece di rifiutare e basta.
  return nearestFree(cell, span, b.cols, b.rows, occupancy(b.buttons))
}

function onDragOver(e) {
  if (!e.dataTransfer.types.includes('application/x-track-id')) return
  e.preventDefault()
  dropPreview.value = libraryTarget(e)
  e.dataTransfer.dropEffect = dropPreview.value ? 'copy' : 'none'
}
function onDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return
  dropPreview.value = null
}
async function onDrop(e) {
  const target = dropPreview.value ?? libraryTarget(e)
  dropPreview.value = null
  const trackId = e.dataTransfer.getData('application/x-track-id')
  if (!trackId || !target) return
  await boards.addButton(library.byId(trackId), target)
}

// ---- Tastiera ----
// Le frecce spostano, con Shift ridimensionano. Serve per l'aggiustamento
// fine, che col trascinamento richiede una mira che a mouse non si ha, e
// perché tutta la modifica di una board non può dipendere dal saper
// trascinare.
// Un campo di testo a fuoco si tiene i suoi tasti. Il listener sta su window
// perché la griglia non ha il fuoco, ma in edit mode ci sono quasi venti fra
// input e textarea (ricerca, tag, etichetta, URL): senza questo controllo
// muovere il cursore fra le lettere della ricerca spostava il bottone
// selezionato, e Ctrl+Z nel campo dell'etichetta annullava la board invece
// del testo appena scritto.
function isTyping(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  return /^(input|textarea|select)$/i.test(target.tagName)
}

async function onKeydown(e) {
  if (isTyping(e.target)) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) await boards.redo()
    else await boards.undo()
    return
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    await boards.redo()
    return
  }
  const btn = boards.selectedButton
  if (!btn) return
  const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key]
  if (!step) return
  e.preventDefault()
  const [dr, dc] = step
  const b = boards.current
  const next = e.shiftKey
    ? resizeBy(btn, e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 'e' : 's', dr, dc)
    : clampToBounds({ ...btn, row: btn.row + dr, col: btn.col + dc }, b.cols, b.rows)
  if (!fits(next, b.cols, b.rows, occupancy(b.buttons, btn.id))) return
  await boards.updateButton(btn.id, next)
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// Il fantasma da disegnare: quello del trascinamento, o quello del rilascio
// dalla libreria.
const ghost = computed(() => {
  if (drag.value) return { place: drag.value.preview, valid: drag.value.valid }
  if (dropPreview.value) return { place: dropPreview.value, valid: true }
  return null
})
const gridArea = (p) => ({
  gridRow: `${p.row} / span ${p.rowSpan}`,
  gridColumn: `${p.col} / span ${p.colSpan}`
})
</script>

<template>
  <div class="edit-layout">
    <LibrarySidebar />

    <div class="grid-area">
      <div
        ref="gridEl"
        class="edit-grid"
        :class="{ dragging: !!drag }"
        :style="{
          gridTemplateRows: `repeat(${boards.current.rows}, 1fr)`,
          gridTemplateColumns: `repeat(${boards.current.cols}, 1fr)`
        }"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <div
          v-for="btn in boards.current.buttons"
          :key="btn.id"
          class="btn-wrapper"
          :class="{ moving: drag && drag.id === btn.id, selected: boards.selectedButtonId === btn.id }"
          :style="gridArea(btn)"
          @pointerdown="beginMove($event, btn)"
          @dblclick.stop="playback.triggerButton(btn, library)"
        >
          <SoundButton
            :button="{ ...btn, row: 1, col: 1, rowSpan: 1, colSpan: 1 }"
            :interactive="false"
            :selected="boards.selectedButtonId === btn.id"
          />
          <!-- Otto maniglie sul bottone selezionato: i lati muovono un bordo,
               gli angoli due. Quelle a nord e a ovest spostano l'ancora, ed è
               tutta la differenza: prima la misura si cambiava solo dai campi
               numerici, che tengono fermo l'angolo in alto a sinistra, quindi
               un bottone poteva crescere solo verso destra e verso il basso. -->
          <template v-if="boards.selectedButtonId === btn.id">
            <span
              v-for="h in HANDLES"
              :key="h"
              class="handle"
              :class="'h-' + h"
              @pointerdown="beginResize($event, btn, h)"
            />
          </template>
        </div>

        <div
          v-if="ghost"
          class="ghost"
          :class="{ invalid: !ghost.valid }"
          :style="gridArea(ghost.place)"
        />
      </div>

      <PropertiesPanel />
    </div>
  </div>
</template>

<style scoped>
.edit-layout {
  display: grid;
  grid-template-columns: auto 1fr;
  height: 100%;
}
.grid-area { display: flex; flex-direction: column; min-width: 0; }
.edit-grid {
  display: grid;
  gap: 8px;
  padding: 12px;
  flex: 1;
  min-height: 0;
  background-image:
    linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size: calc(100% / v-bind('boards.current.cols')) calc(100% / v-bind('boards.current.rows'));
  background-origin: content-box;
  touch-action: none; /* se no su touch il gesto lo mangia lo scroll */
}
.btn-wrapper { display: grid; cursor: grab; position: relative; }
.btn-wrapper :deep(.sound-btn) { grid-area: 1 / 1; pointer-events: none; }
/* Il bottone in movimento resta al suo posto, sbiadito: è il fantasma a dire
   dove andrà. Spostare l'originale sotto il dito nasconderebbe proprio le
   celle su cui si sta decidendo. */
.btn-wrapper.moving { opacity: 0.35; cursor: grabbing; }

/* position + z-index non sono decorazione: i .btn-wrapper sono position
   relative, e un elemento non posizionato finisce sotto QUALSIASI posizionato
   a prescindere dall'ordine nel DOM. Senza queste due righe il fantasma rosso
   spariva dietro il bottone su cui stava avvisando — cioè era invisibile
   esattamente nel caso in cui serve. */
.ghost {
  position: relative;
  z-index: 3;
  border: 2px dashed var(--accent);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--accent) 30%, transparent);
  pointer-events: none;
}
.ghost.invalid {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 18%, transparent);
}

.handle {
  position: absolute;
  width: 12px; height: 12px;
  background: var(--accent);
  border: 1px solid var(--bg);
  border-radius: 3px;
  z-index: 2;
}
/* I lati stanno a metà bordo, gli angoli agli spigoli. Il cursore dice quale
   asse muove prima ancora di premere. */
.h-n  { top: -6px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.h-s  { bottom: -6px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.h-w  { left: -6px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
.h-e  { right: -6px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
.h-nw { top: -6px; left: -6px; cursor: nwse-resize; }
.h-se { bottom: -6px; right: -6px; cursor: nwse-resize; }
.h-ne { top: -6px; right: -6px; cursor: nesw-resize; }
.h-sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
</style>
