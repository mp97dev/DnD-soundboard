<script setup>
import { computed } from 'vue'
import { useLibraryStore } from '../stores/library'
import { usePlaybackStore } from '../stores/playback'
import { mediaUrl } from '../media'

const props = defineProps({
  button: { type: Object, required: true },
  interactive: { type: Boolean, default: true }, // false in Edit Mode
  selected: { type: Boolean, default: false }
})

const library = useLibraryStore()
const playback = usePlaybackStore()

const track = computed(() => library.byId(props.button.trackId))

const stateClass = computed(() => {
  const t = track.value
  if (!t) return 'unassigned'
  if (t.missing) return 'missing'
  if (t.type === 'music' && playback.activeMusicId === t.id) return 'active-music'
  if (t.type === 'ambience' && playback.activeAmbienceIds.includes(t.id)) return 'active-ambience'
  if (playback.flashingIds.includes(t.id)) return 'flash'
  return ''
})

const thumb = computed(() =>
  track.value?.thumbnailPath ? mediaUrl(track.value.thumbnailPath) : null
)

const isLoading = computed(
  () => track.value && playback.loadingIds.includes(track.value.id)
)

function onClick() {
  if (props.interactive && track.value) playback.trigger(track.value)
}
</script>

<template>
  <button
    class="sound-btn"
    :class="[stateClass, { selected }]"
    :style="{
      gridRow: `${button.row} / span ${button.rowSpan}`,
      gridColumn: `${button.col} / span ${button.colSpan}`
    }"
    @click="onClick"
  >
    <img v-if="thumb" :src="thumb" class="thumb" alt="" />
    <span v-if="isLoading" class="loading-spinner" aria-hidden="true" />
    <span class="type-dot" :class="track?.type" />
    <span class="label">{{ button.label }}</span>
    <span v-if="track?.missing" class="warn">file mancante</span>
    <span v-else-if="!track" class="warn">nessuna traccia</span>
  </button>
</template>

<style scoped>
.sound-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  overflow: hidden;
  border-radius: var(--radius);
  border: 2px solid var(--border);
  background: var(--bg-raised);
  font-size: clamp(15px, 1.6vw, 22px);
  font-weight: 600;
  padding: 6px;
  transition: border-color 0.15s, background 0.15s, transform 0.06s;
}
.sound-btn:active { transform: scale(0.97); }

.thumb {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  opacity: 0.25;
  pointer-events: none;
}
.label { position: relative; z-index: 1; text-shadow: 0 1px 3px rgba(0,0,0,0.8); text-align: center; }
.warn { position: relative; z-index: 1; font-size: 11px; color: var(--danger); font-weight: 400; }

.type-dot {
  position: absolute; top: 6px; right: 6px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--text-dim);
}

.loading-spinner {
  position: absolute; top: 6px; left: 6px;
  width: 12px; height: 12px;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: btn-spin 0.8s linear infinite;
  z-index: 1;
}
@keyframes btn-spin { to { transform: rotate(360deg); } }
.type-dot.music { background: var(--music); }
.type-dot.ambience { background: var(--ambience); }
.type-dot.oneshot { background: var(--oneshot); }

/* Stati visivi (spec): blu musica, verde ambience, flash one-shot */
.active-music { border-color: var(--music); background: color-mix(in srgb, var(--music) 28%, var(--bg-raised)); }
.active-ambience { border-color: var(--ambience); background: color-mix(in srgb, var(--ambience) 24%, var(--bg-raised)); }
.flash { animation: flash 0.4s ease-out; }
@keyframes flash {
  0% { border-color: var(--oneshot); background: color-mix(in srgb, var(--oneshot) 45%, var(--bg-raised)); }
  100% { border-color: var(--border); background: var(--bg-raised); }
}
.missing { border-style: dashed; opacity: 0.55; }
.unassigned { border-style: dashed; color: var(--text-dim); }
.selected { outline: 2px solid var(--oneshot); outline-offset: 2px; }
</style>
