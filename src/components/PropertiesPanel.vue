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
const audioTracks = computed(() => library.tracks.filter((t) => t.type !== 'visual'))
const visuals = computed(() => library.tracks.filter((t) => t.type === 'visual'))

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
      {{ $t('properties.label') }}
      <input :value="btn.label" @input="update({ label: $event.target.value })" />
    </label>

    <label>
      {{ $t('properties.track') }}
      <select :value="btn.trackId ?? ''" @change="update({ trackId: $event.target.value || null })">
        <option value="">{{ $t('properties.noTrack') }}</option>
        <option v-for="t in audioTracks" :key="t.id" :value="t.id">{{ t.title }}</option>
      </select>
    </label>

    <label>
      {{ $t('properties.visual') }}
      <select :value="btn.visualId ?? ''" @change="update({ visualId: $event.target.value || null })">
        <option value="">{{ $t('properties.noVisual') }}</option>
        <option v-for="v in visuals" :key="v.id" :value="v.id">{{ v.title }}</option>
      </select>
    </label>

    <label v-if="track">
      {{ $t('properties.type') }}
      <select :value="track.type" @change="library.updateTrack(track.id, { type: $event.target.value })">
        <option value="music">{{ $t('properties.typeMusic') }}</option>
        <option value="ambience">{{ $t('properties.typeAmbience') }}</option>
        <option value="oneshot">{{ $t('properties.typeOneshot') }}</option>
      </select>
    </label>

    <label v-if="track">
      {{ $t('properties.volume', { percent: Math.round(track.volume * 100) }) }}
      <input
        type="range" min="0" max="1" step="0.01"
        :value="track.volume"
        @input="setVolume(Number($event.target.value))"
      />
    </label>

    <label>
      {{ $t('properties.width') }}
      <input type="number" min="1" :value="btn.colSpan"
        @change="update({ colSpan: Number($event.target.value) })" />
    </label>

    <label>
      {{ $t('properties.height') }}
      <input type="number" min="1" :value="btn.rowSpan"
        @change="update({ rowSpan: Number($event.target.value) })" />
    </label>

    <button class="danger" @click="boards.removeButton(btn.id)">{{ $t('properties.remove') }}</button>
  </footer>
  <footer class="props dim-panel" v-else>
    {{ $t('properties.empty') }}
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
