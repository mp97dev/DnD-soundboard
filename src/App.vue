<script setup>
import { onMounted, ref } from 'vue'
import { useBoardsStore } from './stores/boards'
import { useLibraryStore } from './stores/library'
import { useSettingsStore } from './stores/settings'
import { usePlaybackStore } from './stores/playback'
import PlayMode from './components/PlayMode.vue'
import EditMode from './components/EditMode.vue'
import ThemeEditor from './components/ThemeEditor.vue'
import { startHealthHeartbeat } from './health'
import { t } from './i18n'

const boards = useBoardsStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const playback = usePlaybackStore()
playback.initAudio()

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
    host = (prompt(t('app.castManualPrompt')) || '').trim() || null
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
  // Stato cast: mostra la riconnessione automatica quando la TV si perde
  setInterval(() => playback.syncCastStatus(), 5000)
  // Battito di salute: in una sessione di ore è l'unico modo per accorgersi di
  // un audio che ha smesso di suonare senza dirlo o di una memoria che cresce.
  // L'intervallo è pilotabile dall'esterno per i soak test (scripts/soak.js).
  startHealthHeartbeat({
    intervalMs: window.api?.env?.healthMs || undefined,
    extra: () => ({
      musica: playback.activeMusicId,
      ambience: playback.activeAmbienceIds.length,
      cast: playback.castConnected,
      castRiconnessione: playback.castReconnecting,
      erroreAudio: playback.audioError
    })
  })
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

async function copyViewerLink() {
  try {
    const url = await window.api.cast.viewerUrl()
    try {
      await navigator.clipboard.writeText(url)
      flashIoMsg(t('app.viewerCopied', { url }))
    } catch {
      flashIoMsg(t('app.viewerUrl', { url }))
    }
  } catch (e) {
    flashIoMsg(t('app.viewerUnavailable', { error: e.message }))
  }
}

async function exportConfig() {
  if (await window.api.config.export()) flashIoMsg(t('app.exported'))
}

async function importConfig() {
  try {
    const res = await window.api.config.import()
    if (!res) return
    await Promise.all([settings.load(), library.load(), boards.load()])
    // Scarica in background TUTTI i file mancanti con un URL sorgente,
    // non solo quelli della board corrente
    library.redownloadMissing()
    // Due conteggi indipendenti nella stessa frase: ognuno si porta dietro il
    // proprio plurale (e in italiano il proprio accordo), la frase li unisce.
    let msg = t('app.imported', {
      boards: t('app.importedBoards', res.boards),
      tracks: t('app.importedTracks', res.addedTracks)
    })
    if (library.missingLocal.length) {
      msg = t('app.importedWithMissing', {
        imported: msg,
        warning: t('app.importedMissingLocal', library.missingLocal.length)
      })
    }
    flashIoMsg(msg)
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
          :placeholder="$t('app.boardNamePlaceholder')"
          @keyup.enter="createBoard"
          autofocus
        />
        <button class="primary" @click="createBoard">{{ $t('app.create') }}</button>
        <button @click="creating = false">{{ $t('app.cancel') }}</button>
      </template>
      <button v-else @click="creating = true">{{ $t('app.newBoard') }}</button>

      <div class="spacer" />

      <span v-if="ioMsg" class="io-msg">{{ ioMsg }}</span>
      <span v-if="playback.castError" class="io-msg cast-error">{{ playback.castError }}</span>
      <span v-else-if="playback.castReconnecting" class="io-msg cast-error">{{ $t('app.castReconnecting') }}</span>
      <span v-if="playback.audioError" class="io-msg cast-error">{{ playback.audioError }}</span>

      <div class="cast" :title="$t('app.castTitle')">
        <span class="dim">📺</span>
        <select :value="settings.castDeviceHost ?? ''" @focus="refreshCastDevices" @change="selectCastDevice">
          <option value="">{{ $t('app.castNone') }}</option>
          <option
            v-if="settings.castDeviceHost && !castDevices.some((d) => d.host === settings.castDeviceHost)"
            :value="settings.castDeviceHost"
          >{{ settings.castDeviceName ?? settings.castDeviceHost }}</option>
          <option v-for="d in castDevices" :key="d.host" :value="d.host">{{ d.name }}</option>
          <option value="__manual">{{ $t('app.castManual') }}</option>
        </select>
        <button
          v-if="playback.activeCastId || playback.castConnected || playback.castReconnecting"
          :title="settings.castDeviceHost ? $t('app.castDisconnect') : $t('app.castClearViewer')"
          @click="playback.stopCast()"
        >✕</button>
      </div>
      <button :title="$t('app.viewerLink')" @click="copyViewerLink">📱</button>
      <ThemeEditor />
      <button :title="$t('app.exportTitle')" @click="exportConfig">{{ $t('app.export') }}</button>
      <button :title="$t('app.importTitle')" @click="importConfig">{{ $t('app.import') }}</button>

      <div class="master">
        <span class="dim">{{ $t('app.master') }}</span>
        <input
          type="range" min="0" max="1" step="0.01"
          :value="settings.masterVolume"
          @input="settings.setMasterVolume(Number($event.target.value))"
        />
      </div>

      <button class="danger" @click="playback.stopAll()">{{ $t('app.stopAll') }}</button>

      <div class="mode-switch">
        <button :class="{ active: boards.mode === 'play' }" @click="boards.setMode('play')">
          {{ $t('app.play') }}
        </button>
        <button :class="{ active: boards.mode === 'edit' }" @click="boards.setMode('edit')">
          {{ $t('app.edit') }}
        </button>
      </div>
    </header>

    <main class="content">
      <div v-if="!boards.current" class="empty">
        <p>{{ $t('app.noBoards') }}</p>
      </div>
      <PlayMode v-else-if="boards.mode === 'play'" />
      <EditMode v-else />
    </main>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
/* La barra va a capo invece di tagliare. Senza flex-wrap i comandi in fondo
   escono dal bordo e spariscono: html ha overflow:hidden, quindi non c'è
   nemmeno una barra di scorrimento per raggiungerli. Misurato a 1100px di
   finestra: 16px di troppo e Play/Edit entrambi oltre il bordo, cioè non si
   può più tornare in riproduzione. L'inglese e i nomi di board lunghi
   stringono ancora di più. */
.toolbar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
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
.master { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dim { color: var(--text-dim); font-size: 13px; }
/* Stop All e Play/Edit non si stringono: sono i comandi che servono subito
   quando qualcosa va storto in sessione, e un bottone schiacciato a mezza
   parola è peggio di uno andato a capo. */
.toolbar .danger { flex-shrink: 0; white-space: nowrap; }
.mode-switch { display: flex; gap: 0; flex-shrink: 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.mode-switch button { border: none; border-radius: 0; white-space: nowrap; }
.mode-switch button.active { background: var(--accent); color: var(--on-accent); }
.content { flex: 1; min-height: 0; }
.empty { display: grid; place-items: center; height: 100%; color: var(--text-dim); }
</style>
