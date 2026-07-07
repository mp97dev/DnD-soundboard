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
const ioMsg = ref('')

// ---- Chromecast ----
const castDevices = ref([])
async function refreshCastDevices() {
  try {
    castDevices.value = await window.api.cast.devices()
  } catch { /* discovery non disponibile */ }
}
function selectCastDevice(ev) {
  let host = ev.target.value || null
  let name = null
  if (host === '__manual') {
    // Fallback per reti dove la discovery mDNS non funziona
    host = (prompt('IP del Chromecast (es. 192.168.1.50):') || '').trim() || null
    name = host
    ev.target.value = settings.castDeviceHost ?? ''
    if (!host) return
  } else {
    name = castDevices.value.find((d) => d.host === host)?.name ?? null
  }
  settings.update({ castDeviceHost: host, castDeviceName: name })
}

onMounted(async () => {
  await Promise.all([settings.load(), library.load(), boards.load()])
  refreshCastDevices()
  // la discovery mDNS impiega qualche secondo a popolare la lista
  setTimeout(refreshCastDevices, 4000)
  // All'avvio nessuno passa da openBoard: il check dei file mancanti
  // della board iniziale va fatto qui (in background)
  const trackIds =
    boards.current?.buttons.flatMap((b) => [b.trackId, b.visualId]).filter(Boolean) ?? []
  library.redownloadMissing(trackIds)
})

async function createBoard() {
  const name = newBoardName.value.trim()
  if (!name) return
  await boards.createBoard(name)
  newBoardName.value = ''
  creating.value = false
}

let ioMsgTimer = null
function flashIoMsg(text) {
  ioMsg.value = text
  clearTimeout(ioMsgTimer)
  ioMsgTimer = setTimeout(() => { ioMsg.value = '' }, 5000)
}

async function exportConfig() {
  if (await window.api.config.export()) flashIoMsg('Configurazione esportata')
}

async function importConfig() {
  try {
    const res = await window.api.config.import()
    if (!res) return
    await Promise.all([settings.load(), library.load(), boards.load()])
    // Scarica in background i file mancanti della board corrente
    const trackIds =
      boards.current?.buttons.flatMap((b) => [b.trackId, b.visualId]).filter(Boolean) ?? []
    library.redownloadMissing(trackIds)
    flashIoMsg(`Importate ${res.boards} board, ${res.addedTracks} nuove tracce`)
  } catch (e) {
    flashIoMsg(e.message)
  }
}
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <span class="logo">⚔️ Soundboard</span>

      <select
        v-if="boards.boards.length"
        class="board-select"
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

      <span v-if="ioMsg" class="io-msg">{{ ioMsg }}</span>
      <span v-if="playback.castError" class="io-msg cast-error">{{ playback.castError }}</span>

      <div class="cast" title="Chromecast su cui mostrare i visual">
        <span class="dim">📺</span>
        <select :value="settings.castDeviceHost ?? ''" @focus="refreshCastDevices" @change="selectCastDevice">
          <option value="">— nessun cast —</option>
          <option
            v-if="settings.castDeviceHost && !castDevices.some((d) => d.host === settings.castDeviceHost)"
            :value="settings.castDeviceHost"
          >{{ settings.castDeviceName ?? settings.castDeviceHost }}</option>
          <option v-for="d in castDevices" :key="d.host" :value="d.host">{{ d.name }}</option>
          <option value="__manual">IP manuale…</option>
        </select>
        <button
          v-if="playback.activeCastId"
          title="Interrompi il cast"
          @click="playback.stopCast()"
        >✕</button>
      </div>
      <button title="Esporta board e impostazioni (senza gli mp3)" @click="exportConfig">⤓ Esporta</button>
      <button title="Importa board e impostazioni da file" @click="importConfig">⤒ Importa</button>

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
.io-msg { color: var(--text-dim); font-size: 12px; }
.cast-error { color: var(--danger); }
.cast { display: flex; align-items: center; gap: 6px; }
.cast select { max-width: 160px; }
.master { display: flex; align-items: center; gap: 8px; }
.dim { color: var(--text-dim); font-size: 13px; }
.mode-switch { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.mode-switch button { border: none; border-radius: 0; }
.mode-switch button.active { background: var(--music); }
.content { flex: 1; min-height: 0; }
.empty { display: grid; place-items: center; height: 100%; color: var(--text-dim); }
</style>
