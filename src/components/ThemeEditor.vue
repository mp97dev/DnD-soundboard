<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { CUSTOM_KEYS, THEME_PALETTES, useSettingsStore } from '../stores/settings'

const settings = useSettingsStore()

// Il pannello è un popover, non una finestra modale: i colori si applicano
// mentre si trascina il cursore e il senso è vedere l'app vera che cambia
// dietro, non un'anteprima che la copre.
const open = ref(false)
const root = ref(null)

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
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeydown)
  } else {
    unbind()
  }
})
onBeforeUnmount(unbind)

const options = ['candela', 'notturno', 'giorno', 'custom']

// Le lingue si scrivono sempre nella propria lingua: "English" tradotto in
// "Inglese" lo trova solo chi sa già l'italiano, cioè non chi lo sta cercando.
const languages = [
  { id: 'it', name: 'Italiano' },
  { id: 'en', name: 'English' }
]

// La palette personale esiste anche prima che si scelga 'Personale': serve ai
// sette picker e al riquadro d'anteprima, che non possono partire da vuoti.
const customPalette = computed(() => ({ ...THEME_PALETTES.candela, ...settings.customTheme }))
const paletteOf = (id) => (id === 'custom' ? customPalette.value : THEME_PALETTES[id])

// Le stesse derivazioni di tokens.css per il tema custom: nell'anteprima di un
// riquadro da 60px non serve altro, e così i tre temi e il personale si
// mostrano tutti con la stessa regola invece che con valori a parte.
const preview = (p) => ({
  background: p.bg,
  borderColor: `color-mix(in srgb, ${p.bg} 74%, ${p.text})`
})
const previewBar = (p) => ({ background: `color-mix(in srgb, ${p.bg} 92%, ${p.text})` })

function pick(id) {
  settings.setTheme(id)
}
</script>

<template>
  <div class="theme-editor" ref="root">
    <button
      class="theme-btn"
      :title="$t('appearance.title')"
      :aria-label="$t('appearance.title')"
      :aria-expanded="open"
      @click="open = !open"
    >🎨</button>

    <div v-if="open" class="panel">
      <h4>{{ $t('appearance.theme') }}</h4>

      <div class="grid">
        <button
          v-for="id in options"
          :key="id"
          class="card"
          :class="{ active: settings.theme === id }"
          @click="pick(id)"
        >
          <span class="swatch" :style="preview(paletteOf(id))">
            <span class="swatch-bar" :style="previewBar(paletteOf(id))">
              <span class="swatch-pill" :style="{ background: paletteOf(id).accent }" />
              <span class="swatch-text" :style="{ color: paletteOf(id).text }">Aa</span>
            </span>
            <span class="swatch-dots">
              <span
                v-for="k in ['music', 'ambience', 'oneshot', 'visual']"
                :key="k"
                class="dot"
                :style="{ background: paletteOf(id)[k] }"
              />
            </span>
          </span>
          <span class="card-name">{{ $t(`appearance.themes.${id}.name`) }}</span>
          <span class="card-hint">{{ $t(`appearance.themes.${id}.hint`) }}</span>
        </button>
      </div>

      <div v-if="settings.theme === 'custom'" class="custom">
        <div class="colors">
          <label v-for="key in CUSTOM_KEYS" :key="key">
            <input
              type="color"
              :value="customPalette[key]"
              @input="settings.previewCustom(key, $event.target.value)"
              @change="settings.persistCustom()"
            />
            <span>{{ $t(`appearance.colors.${key}`) }}</span>
          </label>
        </div>
        <p class="note">{{ $t('appearance.note') }}</p>
        <button class="reset" @click="settings.resetCustom()">{{ $t('appearance.reset') }}</button>
      </div>

      <!-- La lingua sta qui e non in un altro bottone: la toolbar è già piena, e
           tema e lingua sono la stessa cosa — come si presenta l'app, scelto una
           volta e mai più. Un secondo popover accanto a questo sarebbe solo
           un'altra icona da indovinare. -->
      <h4>{{ $t('appearance.language') }}</h4>
      <div class="langs">
        <button
          v-for="l in languages"
          :key="l.id"
          class="card lang"
          :class="{ active: settings.locale === l.id }"
          :lang="l.id"
          :aria-pressed="settings.locale === l.id"
          @click="settings.setLocale(l.id)"
        >{{ l.name }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-editor { position: relative; display: flex; }
.theme-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; padding: 10px 0; font-size: 15px;
}
.panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 20;
  width: 300px;
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  /* Ombra fatta col fondo del tema, non con un nero: su Giorno un alone scuro
     sotto un pannello chiaro sporca invece di staccare. */
  box-shadow: 0 8px 24px color-mix(in srgb, var(--bg) 55%, transparent);
}
h4 { margin: 0; font-size: 12px; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.6px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
/* Fondo --bg e non --bg-raised, come i campi di input: su --bg-raised il
   sottotitolo in --text-dim scende sotto 4.5:1 in notturno e nelle palette
   personali derivate, e la scelta del tema è esattamente il posto dove la
   riga piccola deve restare leggibile. */
.card {
  display: flex; flex-direction: column; gap: 3px;
  padding: 6px; text-align: left;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
}
.card.active { border-color: var(--accent); }
.card-name { font-weight: 600; }
.card-hint { font-size: 11px; color: var(--text-dim); }
/* L'anteprima è un mini-ritratto del tema: fondo, barra col suo accento, una
   riga di testo e i quattro colori di categoria. Un nome in una lista non dice
   niente su come sarà la board. */
.swatch {
  display: block; height: 46px; margin-bottom: 3px;
  border: 1px solid; border-radius: 5px; overflow: hidden;
}
.swatch-bar {
  display: flex; align-items: center; gap: 4px;
  height: 18px; padding: 0 4px;
}
.swatch-pill { width: 14px; height: 5px; border-radius: 3px; flex-shrink: 0; }
.swatch-text { font-size: 10px; line-height: 1; }
.swatch-dots { display: flex; gap: 4px; padding: 7px 5px; }
.dot { width: 9px; height: 9px; border-radius: 50%; }
.custom { display: flex; flex-direction: column; gap: 8px; }
.colors { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
.colors label {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px;
}
.colors input[type='color'] {
  width: 30px; height: 24px; padding: 2px; flex-shrink: 0;
  background: var(--bg-raised);
  cursor: pointer;
}
.note { margin: 0; font-size: 11px; color: var(--text-dim); line-height: 1.4; }
.langs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.lang { align-items: center; text-align: center; font-weight: 600; }
.reset { font-size: 12px; padding: 7px 10px; }
</style>
