import { ref } from 'vue'
import { mediaUrl } from './media'

// Anteprima audio della libreria: UN SOLO elemento <audio> per tutta
// l'applicazione, non uno per componente.
//
// La sidebar e il dialogo mostrano le stesse tracce e vivono insieme (il
// dialogo si apre DA lì e la sidebar resta montata sotto). Con un elemento per
// componente bastava avviare un'anteprima di qua e una di là per ritrovarsi due
// brani sovrapposti in cuffia mentre al tavolo si gioca, e per fermarli
// bisognava ricordarsi da quale delle due liste erano partiti. Lo stato vive
// qui fuori: chi parte per secondo spegne chi c'era prima, sempre.
//
// Volutamente separato dal motore audio della board (audio/engine.js): questo
// è un ascolto di controllo del DM, non deve passare dal master volume né
// comparire fra le voci attive.
export const previewId = ref(null)

let el = null

export function stopPreview() {
  if (el) {
    el.pause()
    // Senza togliere la sorgente e ricaricare, Chromium tiene aperto il
    // decoder: su una sessione lunga fatta di decine di ascolti brevi è
    // memoria che non torna più indietro.
    el.removeAttribute('src')
    el.load()
    el = null
  }
  previewId.value = null
}

export function togglePreview(track) {
  if (previewId.value === track.id) return stopPreview()
  stopPreview()
  const audio = new Audio(mediaUrl(track.audioPath))
  audio.volume = track.volume ?? 1
  // Solo se è ancora l'anteprima corrente: un onended arrivato in ritardo non
  // deve spegnere quella che l'utente ha appena avviato al suo posto.
  const stopIfCurrent = () => { if (el === audio) stopPreview() }
  audio.onended = stopIfCurrent
  audio.play().catch(stopIfCurrent)
  el = audio
  previewId.value = track.id
}
