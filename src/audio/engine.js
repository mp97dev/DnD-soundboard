// Motore audio basato su Web Audio API.
// Canali: Music (esclusivo), Ambience (additivo), One-Shot (transiente).
// I file audio sono serviti via mediaUrl(): protocollo media:// in Electron,
// rotta HTTP /media/ quando il renderer gira nel browser (server LAN).
import { mediaUrl } from '../media'
//
// Music e ambience (file lunghi, in loop) vanno in STREAMING con
// HTMLAudioElement: partenza immediata e niente PCM decodificato in RAM
// (1h stereo decodificata ≈ 1.2 GB). I one-shot restano su AudioBuffer
// per trigger istantanei e sovrapponibili.

// latencyHint 'playback': buffer di output più grande, meno underrun
// (click/stutter) su macchine lente o con driver audio Windows/WSL capricciosi.
// La latenza extra (~decine di ms) è irrilevante per una soundboard.
const ctx = new AudioContext({ latencyHint: 'playback' })
const masterGain = ctx.createGain()
masterGain.connect(ctx.destination)

// Cache dei soli one-shot: file brevi, footprint contenuto
const bufferCache = new Map()

async function loadBuffer(audioPath) {
  if (bufferCache.has(audioPath)) return bufferCache.get(audioPath)
  const res = await fetch(mediaUrl(audioPath))
  if (!res.ok) throw new Error(`Audio non trovato: ${audioPath}`)
  const buf = await ctx.decodeAudioData(await res.arrayBuffer())
  bufferCache.set(audioPath, buf)
  return buf
}

// Interfaccia voice comune: { gain, start(), stop(afterMs) }
// afterMs ritarda il rilascio per lasciar completare il fade sul gain.

function makeBufferVoice(buffer, { loop = false, volume = 1 } = {}) {
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = loop
  const gain = ctx.createGain()
  gain.gain.value = volume
  source.connect(gain)
  gain.connect(masterGain)
  source.onended = () => gain.disconnect()
  return {
    gain,
    start: () => source.start(),
    stop: (afterMs = 0) => source.stop(ctx.currentTime + afterMs / 1000 + 0.05)
  }
}

function makeStreamVoice(audioPath, { loop = false, volume = 1 } = {}) {
  const el = new Audio()
  // Senza crossOrigin il MediaElementSource su media:// (cross-origin
  // rispetto al renderer) emette silenzio per tainting
  el.crossOrigin = 'anonymous'
  el.src = mediaUrl(audioPath)
  el.loop = loop
  el.preload = 'auto'
  const source = ctx.createMediaElementSource(el)
  const gain = ctx.createGain()
  gain.gain.value = volume
  source.connect(gain)
  gain.connect(masterGain)
  return {
    gain,
    async start() {
      try {
        await el.play()
      } catch {
        gain.disconnect()
        throw new Error(`Audio non trovato o non riproducibile: ${audioPath}`)
      }
    },
    stop: (afterMs = 0) => {
      setTimeout(() => {
        el.pause()
        el.removeAttribute('src')
        el.load() // rilascia il decoder/stream
        source.disconnect()
        gain.disconnect()
      }, afterMs + 50)
    }
  }
}

// Fade esponenziali (setTargetAtTime) invece di rampe lineari: con la rampa
// lineare la traccia entrante resta quasi inudibile per metà crossfade
// ("cambio canzone lento"); l'attacco esponenziale la porta al ~75% già a un
// terzo della durata, e il decay suona più naturale di un taglio lineare.
function fadeOutAndStop(voice, durationMs) {
  const now = ctx.currentTime
  const tau = Math.max(durationMs, 1) / 1000 / 4 // a 4τ il decay è al ~98%
  voice.gain.gain.cancelScheduledValues(now)
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
  voice.gain.gain.setTargetAtTime(0, now, tau)
  voice.stop(durationMs)
}

function fadeIn(voice, targetVolume, durationMs) {
  const now = ctx.currentTime
  const tau = Math.max(durationMs, 1) / 1000 / 4
  voice.gain.gain.setValueAtTime(0.0001, now)
  voice.gain.gain.setTargetAtTime(targetVolume, now, tau)
}

// ---- Stato canali ----
let musicVoice = null // { trackId, voice }
const ambienceVoices = new Map() // trackId -> voice

export const engine = {
  resume: () => ctx.resume(),

  setMasterVolume(v) {
    masterGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02)
  },

  setTrackVolume(trackId, v) {
    if (musicVoice?.trackId === trackId) {
      musicVoice.voice.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.02)
    }
    const amb = ambienceVoices.get(trackId)
    if (amb) amb.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.02)
  },

  // ---- Music: canale esclusivo con transizioni ----
  async playMusic(track, { transition = 'crossfade', duration = 3000 } = {}) {
    await ctx.resume()
    const fading = transition === 'crossfade' || transition === 'fade'

    const startNew = async () => {
      // Parte quasi muto se in fade: il volume lo porta su fadeIn
      const voice = makeStreamVoice(track.audioPath, {
        loop: true,
        volume: fading ? 0.0001 : track.volume
      })
      await voice.start()
      if (fading) fadeIn(voice, track.volume, duration)
      musicVoice = { trackId: track.id, voice }
    }

    const old = musicVoice
    musicVoice = null

    if (!old) {
      await startNew()
    } else if (transition === 'instant') {
      old.voice.stop()
      await startNew()
    } else if (transition === 'crossfade') {
      fadeOutAndStop(old.voice, duration)
      await startNew()
    } else {
      // fade: prima out, poi in
      fadeOutAndStop(old.voice, duration)
      setTimeout(() => startNew().catch(() => {}), duration)
    }
  },

  stopMusic({ duration = 1000 } = {}) {
    if (!musicVoice) return
    fadeOutAndStop(musicVoice.voice, duration)
    musicVoice = null
  },

  get activeMusicId() {
    return musicVoice?.trackId ?? null
  },

  // ---- Ambience: additivo, illimitato ----
  async playAmbience(track) {
    await ctx.resume()
    if (ambienceVoices.has(track.id)) return
    const voice = makeStreamVoice(track.audioPath, { loop: true, volume: 0.0001 })
    await voice.start()
    fadeIn(voice, track.volume, 500)
    ambienceVoices.set(track.id, voice)
  },

  stopAmbience(trackId) {
    const voice = ambienceVoices.get(trackId)
    if (!voice) return
    fadeOutAndStop(voice, 500)
    ambienceVoices.delete(trackId)
  },

  isAmbienceActive(trackId) {
    return ambienceVoices.has(trackId)
  },

  get activeAmbienceIds() {
    return [...ambienceVoices.keys()]
  },

  // ---- One-Shot: fire and forget ----
  async playOneShot(track) {
    await ctx.resume()
    const buffer = await loadBuffer(track.audioPath)
    const voice = makeBufferVoice(buffer, { loop: false, volume: track.volume })
    voice.start()
  },

  // ---- Stop All ----
  stopAll() {
    this.stopMusic({ duration: 300 })
    for (const id of [...ambienceVoices.keys()]) this.stopAmbience(id)
  }
}
