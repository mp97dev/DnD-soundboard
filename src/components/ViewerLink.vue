<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'

// Popover col link del viewer: il QR è il modo più rapido per aprirlo da un
// telefono, che dell'URL copiato negli appunti del PC non se ne fa niente.
const open = ref(false)
const root = ref(null)
const url = ref('')
const qr = ref('')
const error = ref('')
const copied = ref(false)

async function load() {
  url.value = ''
  qr.value = ''
  error.value = ''
  copied.value = false
  try {
    url.value = await window.api.cast.viewerUrl()
    // Bianco/nero fissi e margine pieno: un QR coi colori del tema scuro
    // (chiaro su scuro) molte fotocamere non lo leggono
    qr.value = await QRCode.toDataURL(url.value, { margin: 2, width: 220, errorCorrectionLevel: 'M' })
  } catch (e) {
    error.value = e.message
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(url.value)
    copied.value = true
  } catch {
    copied.value = false
  }
}

function onPointerDown(e) {
  if (!root.value?.contains(e.target)) open.value = false
}
function onKeydown(e) {
  if (e.key === 'Escape') open.value = false
}
function unbind() {
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKeydown)
}
watch(open, (v) => {
  if (v) {
    load()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeydown)
  } else {
    unbind()
  }
})
onBeforeUnmount(unbind)
</script>

<template>
  <div class="viewer-link" ref="root">
    <button
      :title="$t('app.viewerLink')"
      :aria-label="$t('app.viewerLink')"
      :aria-expanded="open"
      @click="open = !open"
    >📱</button>

    <div v-if="open" class="panel">
      <p class="hint">{{ $t('app.viewerScan') }}</p>
      <p v-if="error" class="error">{{ $t('app.viewerUnavailable', { error }) }}</p>
      <template v-else-if="url">
        <img v-if="qr" class="qr" :src="qr" :alt="url" width="220" height="220" />
        <code class="url">{{ url }}</code>
        <button @click="copy">{{ copied ? $t('app.viewerCopiedShort') : $t('app.viewerCopy') }}</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.viewer-link { position: relative; display: flex; }
.panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 20;
  width: 260px;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--bg) 55%, transparent);
}
.hint { margin: 0; font-size: 12px; color: var(--text-dim); text-align: center; }
.qr { display: block; border-radius: 6px; image-rendering: pixelated; }
.url { font-size: 12px; word-break: break-all; text-align: center; user-select: all; }
.error { margin: 0; font-size: 12px; color: var(--danger); }
</style>
