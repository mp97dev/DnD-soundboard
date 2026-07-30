import { defineStore } from 'pinia'
import { engine } from '../audio/engine'

// I sette colori che l'utente sceglie per il tema personale: tokens.css ricava
// da bg e text i quattro token strutturali, quindi qui non si nominano.
export const CUSTOM_KEYS = ['bg', 'text', 'accent', 'music', 'ambience', 'oneshot', 'visual']

// Copia delle palette di tokens.css, che serve per DUE cose che il CSS non può
// dare: il valore di partenza dell'editor personale e le anteprime dei temi.
// I token vivono su :root, quindi dentro la pagina esiste solo il tema attivo e
// un riquadro non può leggere i colori di un tema che non è quello acceso.
// Se tokens.css cambia palette, questa tabella va aggiornata con lui.
export const THEME_PALETTES = {
  candela: {
    bg: '#17130f', text: '#ece3d2', accent: '#c9922f',
    music: '#4a7c9b', ambience: '#6b8f5e', oneshot: '#c9622f', visual: '#8a6bab'
  },
  notturno: {
    bg: '#12121c', text: '#e4e2f0', accent: '#d4af5f',
    music: '#5b8fd6', ambience: '#3fae94', oneshot: '#e0864a', visual: '#a578e0'
  },
  giorno: {
    bg: '#efede6', text: '#232019', accent: '#a2701a',
    music: '#2e6a99', ambience: '#3f7d4e', oneshot: '#b3591b', visual: '#6d4b9e'
  }
}

export const THEMES = ['candela', 'notturno', 'giorno', 'custom']

// Chiavi del mirror in localStorage, letto dallo script di boot di index.html
const LS_THEME = 'theme'
const LS_CUSTOM = 'customTheme'
const LS_SCHEME = 'themeScheme'

// Luminanza relativa (WCAG) di un #rrggbb. Sopra 0.18 il colore è più vicino al
// bianco che al nero, ed è la soglia con cui si decide chiaro/scuro.
function isLight(hex) {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.18
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    version: 1,
    masterVolume: 0.8,
    musicTransition: 'crossfade',
    transitionDuration: 3000,
    castDeviceHost: null,
    castDeviceName: null,
    theme: null,
    customTheme: null
  }),
  actions: {
    async load() {
      const s = await window.api.settings.get()
      Object.assign(this, s)
      // Primo avvio: tema null sul disco = nessuno ha ancora scelto. Si segue
      // l'OS e la scelta viene subito scritta, così da qui in avanti vale quella
      // dell'utente e non più quella di sistema.
      // La domanda va fatta al FILE, non al mirror in localStorage: i due vivono
      // in cartelle diverse (il mirror sta nella userData di Electron, le
      // impostazioni nella data dir) e possono sparire uno senza l'altro. Se a
      // decidere fosse l'assenza del mirror, perderlo cancellerebbe di nascosto
      // un tema scelto apposta — riscrivendoci sopra quello di sistema.
      if (!this.theme) {
        this.theme = window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'giorno'
          : 'candela'
        this.applyTheme()
        await this.persist()
      } else {
        this.applyTheme()
      }
      engine.setMasterVolume(this.masterVolume)
    },
    // Scrive il tema su <html>: attributo per i tre temi accordati a mano, più
    // le proprietà inline quando la palette è quella dell'utente.
    applyTheme() {
      const root = document.documentElement
      const theme = THEMES.includes(this.theme) ? this.theme : 'candela'
      root.setAttribute('data-theme', theme)
      const palette = theme === 'custom' ? { ...THEME_PALETTES.candela, ...this.customTheme } : null
      for (const k of CUSTOM_KEYS) {
        // Le inline vanno tolte uscendo da custom, altrimenti sopravvivono
        // all'attributo e continuano a vincere sul tema appena scelto.
        if (palette) root.style.setProperty(`--${k}`, palette[k])
        else root.style.removeProperty(`--${k}`)
      }
      // color-scheme comanda scrollbar, dialog e widget nativi. Per i tre temi
      // accordati lo dichiara tokens.css; per una palette scelta a mano solo qui
      // si sa se è chiara o scura, e senza questa riga un tema personale chiaro
      // si porta dietro le scrollbar nere di candela.
      const scheme = palette ? (isLight(palette.bg) ? 'light' : 'dark') : ''
      root.style.colorScheme = scheme
      localStorage.setItem(LS_THEME, theme)
      if (scheme) localStorage.setItem(LS_SCHEME, scheme)
      else localStorage.removeItem(LS_SCHEME)
      if (this.customTheme) localStorage.setItem(LS_CUSTOM, JSON.stringify(this.customTheme))
      else localStorage.removeItem(LS_CUSTOM)
    },
    async setTheme(theme) {
      this.theme = theme
      // Passando a personale senza una palette salvata si parte da candela,
      // così i sette color picker hanno subito un valore da mostrare.
      if (theme === 'custom' && !this.customTheme) this.customTheme = { ...THEME_PALETTES.candela }
      this.applyTheme()
      await this.persist()
    },
    // Trascinare un color picker deve tingere l'app all'istante: si applica a
    // ogni movimento e si scrive su disco solo a scelta conclusa (persistCustom).
    previewCustom(key, value) {
      this.customTheme = { ...THEME_PALETTES.candela, ...this.customTheme, [key]: value }
      this.applyTheme()
    },
    async persistCustom() {
      this.applyTheme()
      await this.persist()
    },
    async resetCustom() {
      this.customTheme = { ...THEME_PALETTES.candela }
      this.applyTheme()
      await this.persist()
    },
    async setMasterVolume(v) {
      this.masterVolume = v
      engine.setMasterVolume(v)
      await this.persist()
    },
    async update(patch) {
      Object.assign(this, patch)
      await this.persist()
    },
    async persist() {
      // $state è un Proxy reattivo: il contextBridge lo rifiuta, serve il clone
      await window.api.settings.save(JSON.parse(JSON.stringify(this.$state)))
    }
  }
})
