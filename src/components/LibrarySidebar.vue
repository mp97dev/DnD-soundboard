<script setup>
import { ref } from 'vue'
import { useLibraryStore } from '../stores/library'

const library = useLibraryStore()
const ytUrl = ref('')

const phaseLabels = {
  metadata: 'Recupero informazioni…',
  audio: 'Download audio…',
  convert: 'Conversione in MP3…',
  thumbnail: 'Download copertina…'
}
function jobLabel(job) {
  if (job.status === 'error') return job.error
  return phaseLabels[job.phase] || 'In coda…'
}
// Percentuale solo per la fase audio; le altre sono indeterminate
function jobPct(job) {
  return job.status === 'active' && job.phase === 'audio' && job.percent != null
    ? Math.min(100, Math.round(job.percent))
    : null
}

const sections = [
  { type: 'music', label: 'Musica' },
  { type: 'ambience', label: 'Ambience' },
  { type: 'oneshot', label: 'One-Shot' }
]

async function addYoutube() {
  const text = ytUrl.value.trim()
  if (!text) return
  await library.addFromYoutubeBulk(text)
  ytUrl.value = ''
}

function onDragStart(e, track) {
  e.dataTransfer.setData('application/x-track-id', track.id)
  e.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="sidebar">
    <h3>Libreria</h3>

    <input v-model="library.search" placeholder="Cerca..." class="search" />

    <div class="import">
      <textarea
        v-model="ytUrl"
        class="yt-input"
        rows="2"
        placeholder="URL o playlist YouTube"
        @keydown.enter.exact.prevent="addYoutube"
      />
      <button
        class="primary icon-btn"
        title="Scarica audio da YouTube (una o più righe, anche playlist)"
        aria-label="Scarica audio da YouTube"
        @click="addYoutube"
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
    </div>
    <div v-if="library.jobs.length" class="jobs">
      <div v-for="job in library.jobs" :key="job.id" class="job" :class="{ failed: job.status === 'error' }">
        <div class="job-row">
          <span class="job-title" :title="job.title">{{ job.title }}</span>
          <span v-if="jobPct(job) !== null" class="job-pct">{{ jobPct(job) }}%</span>
          <button
            v-if="job.status === 'error'"
            class="job-dismiss"
            title="Rimuovi"
            aria-label="Rimuovi"
            @click="library.dismissJob(job.id)"
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
    <button class="import-local" @click="library.importLocal()">+ Importa audio locale</button>
    <button
      v-if="library.missingDownloadable.length"
      class="import-local update-library"
      :disabled="library.downloading"
      @click="library.redownloadMissing()"
    >
      ⟳ Scarica {{ library.missingDownloadable.length }} file mancanti
    </button>
    <p v-if="library.error" class="error">{{ library.error }}</p>

    <div class="sections">
      <section v-for="s in sections" :key="s.type">
        <h4>{{ s.label }}</h4>
        <div
          v-for="t in library.byType(s.type)"
          :key="t.id"
          class="track"
          :class="{ missing: t.missing }"
          draggable="true"
          @dragstart="onDragStart($event, t)"
        >
          <span class="type-dot" :class="t.type" />
          <span class="title" :title="t.missing ? `${t.title} (file mancante)` : t.title">
            {{ t.title }}
          </span>
          <span v-if="t.missing" class="missing-badge" title="File audio mancante">⚠</span>
        </div>
        <p v-if="!library.byType(s.type).length" class="dim">Vuoto</p>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
h3 { margin: 0; font-size: 15px; }
h4 { margin: 8px 0 4px; font-size: 12px; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.6px; }
.search { width: 100%; }
.import { display: flex; gap: 6px; align-items: stretch; }
.yt-input {
  flex: 1; min-width: 0;
  resize: vertical;
  font-family: inherit; font-size: 13px; line-height: 1.4;
}
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; width: 34px;
}
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
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.type-dot.music { background: var(--music); }
.type-dot.ambience { background: var(--ambience); }
.type-dot.oneshot { background: var(--oneshot); }
.dim { color: var(--text-dim); font-size: 12px; margin: 2px 0; }
</style>
