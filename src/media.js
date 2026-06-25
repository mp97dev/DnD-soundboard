// Base degli URL dei file media.
// - Electron: protocollo custom 'media://' servito dal main process.
// - Server web (tablet): il bundle gira nel browser e il web shim imposta
//   window.__MEDIA_BASE__ = '/media/' prima del caricamento dell'app.
// Entrambi i valori si concatenano direttamente a audioPath/thumbnailPath
// (es. 'library/downloaded/x.mp3'), che nel JSON usa sempre '/'.
const BASE = (typeof window !== 'undefined' && window.__MEDIA_BASE__) || 'media://'

export const mediaUrl = (relPath) => `${BASE}${relPath}`
