<script setup>
import { computed } from 'vue'
import { useBoardsStore } from '../stores/boards'
import { useLibraryStore } from '../stores/library'
import { usePlaybackStore } from '../stores/playback'

const boards = useBoardsStore()
const library = useLibraryStore()
const playback = usePlaybackStore()

const btn = computed(() => boards.selectedButton)
const track = computed(() => (btn.value ? library.byId(btn.value.trackId) : null))

function update(patch) {
  boards.updateButton(btn.value.id, patch)
}

function setVolume(v) {
  if (!track.value) return
  library.updateTrack(track.value.id, { volume: v })
  playback.setTrackVolume(track.value.id, v)
}
</script>

<template>
  <footer class="props" v-if="btn">
    <label>
      Etichetta
      <input :value="btn.label" @input="update({ label: $event.target.value })" />
    </label>

    <label>
      Traccia
      <select :value="btn.trackId ?? ''" @change="update({ trackId: $event.target.value || null })">
        <option value="">— nessuna —</option>
        <option v-for="t in library.tracks" :key="t.id" :value="t.id">{{ t.title }}</option>
      </select>
    </label>

    <label v-if="track">
      Tipo
      <select :value="track.type" @change="library.updateTrack(track.id, { type: $event.target.value })">
        <option value="music">Musica</option>
        <option value="ambience">Ambience</option>
        <option value="oneshot">One-Shot</option>
      </select>
    </label>

    <label v-if="track">
      Volume {{ Math.round(track.volume * 100) }}%
      <input
        type="range" min="0" max="1" step="0.01"
        :value="track.volume"
        @input="setVolume(Number($event.target.value))"
      />
    </label>

    <label>
      Larghezza
      <input type="number" min="1" :value="btn.colSpan"
        @change="update({ colSpan: Number($event.target.value) })" />
    </label>

    <label>
      Altezza
      <input type="number" min="1" :value="btn.rowSpan"
        @change="update({ rowSpan: Number($event.target.value) })" />
    </label>

    <button class="danger" @click="boards.removeButton(btn.id)">Elimina bottone</button>
  </footer>
  <footer class="props dim-panel" v-else>
    Seleziona un bottone per modificarne le proprietà — trascina una traccia dalla libreria per crearne uno.
  </footer>
</template>

<style scoped>
.props {
  display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap;
  padding: 12px 14px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  min-height: 64px;
}
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-dim); }
select { max-width: 240px; }
input[type='number'] { width: 70px; }
.dim-panel { align-items: center; color: var(--text-dim); font-size: 13px; }
</style>
