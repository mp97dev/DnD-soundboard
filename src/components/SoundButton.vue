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
const visual = computed(() => library.byId(props.button.visualId))

const isCasting = computed(
  () => visual.value && playback.activeCastId === visual.value.id
)

const stateClass = computed(() => {
  const t = track.value
  const v = visual.value
  if (!t && !v) return 'unassigned'
  if (t?.missing || v?.missing) return 'missing'
  if (t?.type === 'music' && playback.activeMusicId === t.id) return 'active-music'
  if (t?.type === 'ambience' && playback.activeAmbienceIds.includes(t.id)) return 'active-ambience'
  if (t && playback.flashingIds.includes(t.id)) return 'flash'
  if (isCasting.value) return 'active-cast'
  return ''
})

// Copertina: quella della traccia, altrimenti quella del visual; per le
// immagini locali senza thumbnail si usa l'immagine stessa
const thumb = computed(() => {
  if (track.value?.thumbnailPath) return mediaUrl(track.value.thumbnailPath)
  const v = visual.value
  if (!v) return null
  if (v.thumbnailPath) return mediaUrl(v.thumbnailPath)
  if (v.mediaPath && /\.(jpe?g|png|webp|gif|bmp)$/i.test(v.mediaPath)) return mediaUrl(v.mediaPath)
  return null
})

const isLoading = computed(
  () => track.value && playback.loadingIds.includes(track.value.id)
)

// Distingue a colpo d'occhio video, immagini e scene (audio + visual):
// prima c'era solo un 📺 generico per qualsiasi visual
const IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i
const visualKind = computed(() => {
  const v = visual.value
  if (!v) return null
  return IMG_RE.test(v.mediaPath || '') ? 'image' : 'video'
})
const castBadge = computed(() => {
  const icon = visualKind.value === 'image' ? '🖼️' : '🎬'
  return track.value ? `♪${icon}` : icon
})
const castTitle = computed(() => {
  const media = visualKind.value === 'image' ? 'immagine' : 'video'
  return track.value
    ? `Scena: audio + ${media} sul Chromecast`
    : `${media[0].toUpperCase()}${media.slice(1)} sul Chromecast`
})

function onClick() {
  if (props.interactive && (track.value || visual.value)) {
    playback.triggerButton(props.button, library)
  }
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
    <span class="type-dot" :class="track?.type ?? (visual ? 'visual' : null)" />
    <span v-if="visual" class="cast-badge" :class="{ casting: isCasting }" :title="castTitle">{{ castBadge }}</span>
    <span class="label">{{ button.label }}</span>
    <span v-if="track?.missing || visual?.missing" class="warn">file mancante</span>
    <span v-else-if="!track && !visual" class="warn">nessuna traccia</span>
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
.type-dot.visual { background: var(--visual); }

.cast-badge {
  position: absolute; top: 4px; left: 6px;
  font-size: 12px; z-index: 1;
  filter: grayscale(1) opacity(0.6);
}
.cast-badge.casting { filter: none; }

/* Stati visivi (spec): blu musica, verde ambience, flash one-shot */
.active-music { border-color: var(--music); background: color-mix(in srgb, var(--music) 28%, var(--bg-raised)); }
.active-ambience { border-color: var(--ambience); background: color-mix(in srgb, var(--ambience) 24%, var(--bg-raised)); }
.active-cast { border-color: var(--visual); background: color-mix(in srgb, var(--visual) 24%, var(--bg-raised)); }
.flash { animation: flash 0.4s ease-out; }
@keyframes flash {
  0% { border-color: var(--oneshot); background: color-mix(in srgb, var(--oneshot) 45%, var(--bg-raised)); }
  100% { border-color: var(--border); background: var(--bg-raised); }
}
.missing { border-style: dashed; opacity: 0.55; }
.unassigned { border-style: dashed; color: var(--text-dim); }
.selected { outline: 2px solid var(--oneshot); outline-offset: 2px; }
</style>
