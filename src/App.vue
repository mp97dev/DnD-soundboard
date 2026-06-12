<script setup>
import { onMounted, ref } from 'vue'
import { useBoardsStore } from './stores/boards'
import { useLibraryStore } from './stores/library'
import { useSettingsStore } from './stores/settings'
import { usePlaybackStore } from './stores/playback'
import PlayMode from './components/PlayMode.vue'
import EditMode from './components/EditMode.vue'

const boards = useBoardsStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const playback = usePlaybackStore()

const newBoardName = ref('')
const creating = ref(false)

onMounted(async () => {
  await Promise.all([settings.load(), library.load(), boards.load()])
  // All'avvio nessuno passa da openBoard: il check dei file mancanti
  // della board iniziale va fatto qui (in background)
  const trackIds = boards.current?.buttons.map((b) => b.trackId).filter(Boolean) ?? []
  library.redownloadMissing(trackIds)
})

async function createBoard() {
  const name = newBoardName.value.trim()
  if (!name) return
  await boards.createBoard(name)
  newBoardName.value = ''
  creating.value = false
}
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <span class="logo">⚔️ Soundboard</span>

      <select
        v-if="boards.boards.length"
        :value="boards.currentBoardId"
        @change="boards.openBoard($event.target.value)"
      >
        <option v-for="b in boards.boards" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>

      <template v-if="creating">
        <input
          v-model="newBoardName"
          placeholder="Nome board"
          @keyup.enter="createBoard"
          autofocus
        />
        <button class="primary" @click="createBoard">Crea</button>
        <button @click="creating = false">Annulla</button>
      </template>
      <button v-else @click="creating = true">+ Nuova board</button>

      <div class="spacer" />

      <div class="master">
        <span class="dim">Master</span>
        <input
          type="range" min="0" max="1" step="0.01"
          :value="settings.masterVolume"
          @input="settings.setMasterVolume(Number($event.target.value))"
        />
      </div>

      <button class="danger" @click="playback.stopAll()">⏹ Stop All</button>

      <div class="mode-switch">
        <button :class="{ active: boards.mode === 'play' }" @click="boards.setMode('play')">
          ▶ Play
        </button>
        <button :class="{ active: boards.mode === 'edit' }" @click="boards.setMode('edit')">
          ✎ Edit
        </button>
      </div>
    </header>

    <main class="content">
      <div v-if="!boards.current" class="empty">
        <p>Nessuna board. Creane una per iniziare.</p>
      </div>
      <PlayMode v-else-if="boards.mode === 'play'" />
      <EditMode v-else />
    </main>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
.toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.logo { font-weight: 700; letter-spacing: 0.5px; margin-right: 6px; }
.spacer { flex: 1; }
.master { display: flex; align-items: center; gap: 8px; }
.dim { color: var(--text-dim); font-size: 13px; }
.mode-switch { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.mode-switch button { border: none; border-radius: 0; }
.mode-switch button.active { background: var(--music); }
.content { flex: 1; min-height: 0; }
.empty { display: grid; place-items: center; height: 100%; color: var(--text-dim); }
</style>
