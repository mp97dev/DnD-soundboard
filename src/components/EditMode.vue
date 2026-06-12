<script setup>
import { ref } from 'vue'
import { useBoardsStore } from '../stores/boards'
import { useLibraryStore } from '../stores/library'
import LibrarySidebar from './LibrarySidebar.vue'
import PropertiesPanel from './PropertiesPanel.vue'
import SoundButton from './SoundButton.vue'

const boards = useBoardsStore()
const library = useLibraryStore()

const gridEl = ref(null)
const draggingButtonId = ref(null)

function cellFromEvent(e) {
  const rect = gridEl.value.getBoundingClientRect()
  const b = boards.current
  const col = Math.min(b.cols, Math.max(1, Math.ceil(((e.clientX - rect.left) / rect.width) * b.cols)))
  const row = Math.min(b.rows, Math.max(1, Math.ceil(((e.clientY - rect.top) / rect.height) * b.rows)))
  return { row, col }
}

function onDrop(e) {
  const cell = cellFromEvent(e)
  const trackId = e.dataTransfer.getData('application/x-track-id')
  if (trackId) {
    // Drag dalla libreria -> nuovo bottone
    boards.addButton(library.byId(trackId), cell)
  } else if (draggingButtonId.value) {
    // Spostamento bottone esistente
    boards.updateButton(draggingButtonId.value, cell)
    draggingButtonId.value = null
  }
}

function onButtonDragStart(e, btn) {
  draggingButtonId.value = btn.id
  e.dataTransfer.effectAllowed = 'move'
}
</script>

<template>
  <div class="edit-layout">
    <LibrarySidebar />

    <div class="grid-area">
      <div
        ref="gridEl"
        class="edit-grid"
        :style="{
          gridTemplateRows: `repeat(${boards.current.rows}, 1fr)`,
          gridTemplateColumns: `repeat(${boards.current.cols}, 1fr)`
        }"
        @dragover.prevent
        @drop.prevent="onDrop"
      >
        <div
          v-for="btn in boards.current.buttons"
          :key="btn.id"
          class="btn-wrapper"
          :style="{
            gridRow: `${btn.row} / span ${btn.rowSpan}`,
            gridColumn: `${btn.col} / span ${btn.colSpan}`
          }"
          draggable="true"
          @dragstart="onButtonDragStart($event, btn)"
          @click="boards.selectedButtonId = btn.id"
        >
          <SoundButton
            :button="{ ...btn, row: 1, col: 1, rowSpan: 1, colSpan: 1 }"
            :interactive="false"
            :selected="boards.selectedButtonId === btn.id"
          />
        </div>
      </div>

      <PropertiesPanel />
    </div>
  </div>
</template>

<style scoped>
.edit-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
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
}
.btn-wrapper { display: grid; cursor: move; }
.btn-wrapper :deep(.sound-btn) { grid-area: 1 / 1; pointer-events: none; }
</style>
