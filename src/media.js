// Base degli URL dei file media.
// - Electron: protocollo custom 'media://' servito dal main process.
// - Server web (tablet): il bundle gira nel browser e il web shim imposta
//   window.__MEDIA_BASE__ = '/media/' prima del caricamento dell'app.
// Entrambi i valori si concatenano direttamente a audioPath/thumbnailPath
// (es. 'library/downloaded/x.mp3'), che nel JSON usa sempre '/'.
const BASE = (typeof window !== 'undefined' && window.__MEDIA_BASE__) || 'media://'

export const mediaUrl = (relPath) => `${BASE}${relPath}`

// Un visual è un'immagine o un video: si distingue solo dall'estensione, perché
// il tipo 'visual' copre entrambi. La regola stava scritta uguale in tre
// componenti; qui è una sola, così una miniatura che appare nella sidebar
// appare anche nel dialogo e non si scoprono differenze a sessione in corso.
const IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i
export const isImagePath = (p) => IMG_RE.test(p || '')

// Miniatura di una traccia: la copertina scaricata se c'è, altrimenti
// l'immagine stessa per i visual locali. Un mp4 senza copertina non ha niente
// da mostrare e torna null: chi chiama disegna il pallino del tipo.
export function trackThumb(t) {
  if (t.thumbnailPath) return mediaUrl(t.thumbnailPath)
  if (t.mediaPath && isImagePath(t.mediaPath)) return mediaUrl(t.mediaPath)
  return null
}

// 🎬 video / 🖼️ immagine: serve a capire cosa finirà sulla TV prima di
// mandarcelo. Null per tutto ciò che non è un visual.
export function visualIcon(t) {
  if (t.type !== 'visual') return null
  return isImagePath(t.mediaPath) ? '🖼️' : '🎬'
}
