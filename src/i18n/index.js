import { createI18n } from 'vue-i18n'
import it from './it.json'
import en from './en.json'

// Le due lingue spedite. L'italiano è la lingua sorgente: è anche il fallback,
// così una chiave dimenticata in en.json mostra la frase vera invece della chiave.
export const LOCALES = ['it', 'en']

// Mirror della lingua in localStorage. Come per il tema, serve solo a dipingere
// la PRIMA schermata: le impostazioni arrivano dall'IPC (settings.load()) e nel
// frattempo la toolbar è già a video. Senza mirror un utente inglese vedrebbe
// mezzo secondo di italiano ad ogni avvio. A decidere resta il file su disco.
const LS_LOCALE = 'locale'

// Qualsiasi cosa non sia italiano cade sull'inglese: sono le uniche due lingue
// che esistono qui, e una terza lingua di sistema deve avere una UI leggibile.
// navigator.language nel renderer è la lingua di Chromium, che segue quella del
// sistema: basta questa e non serve un canale IPC in più per leggerla.
export function systemLocale() {
  return String(navigator.language || '').toLowerCase().startsWith('it') ? 'it' : 'en'
}

const mirrored = localStorage.getItem(LS_LOCALE)
const initial = LOCALES.includes(mirrored) ? mirrored : systemLocale()

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: initial,
  fallbackLocale: 'it',
  messages: { it, en }
})

// Traduzione fuori dai componenti (store, funzioni pure): lì non c'è un setup()
// dove chiamare useI18n(), e l'istanza globale è comunque la stessa dei template.
export const t = (...args) => i18n.global.t(...args)
// tm/rt servono per le liste (i tag suggeriti): t() sa restituire solo stringhe.
export const tm = (key) => i18n.global.tm(key)
export const rt = (message) => i18n.global.rt(message)

// Cambia lingua e aggiorna il mirror. lang su <html> non è cosmetico: comanda la
// sillabazione e la voce dei lettori di schermo.
export function applyLocale(locale) {
  const next = LOCALES.includes(locale) ? locale : 'it'
  i18n.global.locale.value = next
  document.documentElement.lang = next
  localStorage.setItem(LS_LOCALE, next)
  return next
}

applyLocale(initial)
