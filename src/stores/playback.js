import { defineStore } from 'pinia'
import { engine } from '../audio/engine'
import { useSettingsStore } from './settings'

export const usePlaybackStore = defineStore('playback', {
  state: () => ({
    activeMusicId: null,
    activeAmbienceIds: [],
    flashingIds: [], // one-shot in flash
    loadingIds: [], // tracce in caricamento (apertura stream / decode one-shot)
    activeCastId: null, // visual attualmente in cast sul Chromecast
    castError: null,
    castReconnecting: false, // il backend sta riagganciando la TV persa
    castConnected: false // sessione TV viva (anche se a schermo nero)
  }),
  actions: {
    // Bottone della board: può avere una traccia audio, un visual da castare,
    // o entrambi (= scena). L'audio suona in locale, il visual va in TV.
    async triggerButton(button, library) {
      const track = button.trackId ? library.byId(button.trackId) : null
      const visual = button.visualId ? library.byId(button.visualId) : null
      if (track) await this.trigger(track)
      if (visual && !visual.missing) {
        if (this.activeCastId === visual.id) await this.stopCast()
        else await this.castVisual(visual)
      }
    },
    async castVisual(visual) {
      const settings = useSettingsStore()
      this.castError = null
      if (!settings.castDeviceHost) {
        this.castError = 'Seleziona un Chromecast dal menu 📺 nella toolbar'
        return
      }
      try {
        await window.api.cast.show({
          host: settings.castDeviceHost,
          path: visual.mediaPath,
          title: visual.title
        })
        this.activeCastId = visual.id
        this.castConnected = true
      } catch (e) {
        this.castError = `Cast fallito: ${e.message}`
      }
    },
    async stopCast() {
      this.activeCastId = null
      this.castConnected = false
      this.castReconnecting = false
      try {
        await window.api.cast.stop()
      } catch { /* la TV può essere già spenta */ }
    },
    // Schermo nero senza staccare la TV: la sessione resta pronta per il
    // prossimo visual (usato da "Ferma tutto")
    async blankCast() {
      this.activeCastId = null
      try {
        await window.api.cast.blank()
      } catch { /* la TV può essere già spenta */ }
    },
    // Poll periodico: aggiorna lo stato di riconnessione e spegne l'evidenza
    // del bottone se la sessione è definitivamente persa
    async syncCastStatus() {
      try {
        const st = await window.api.cast.status()
        this.castReconnecting = !!st.reconnecting
        this.castConnected = !!st.casting
        if (!st.casting && !st.reconnecting && this.activeCastId) this.activeCastId = null
      } catch { /* backend non raggiungibile: lascia lo stato com'è */ }
    },
    async trigger(track) {
      const settings = useSettingsStore()
      if (!track || track.missing) return
      if (this.loadingIds.includes(track.id)) return // anti doppio-click

      this.loadingIds.push(track.id)
      try {
        await this._trigger(track, settings)
      } finally {
        this.loadingIds = this.loadingIds.filter((id) => id !== track.id)
      }
    },
    async _trigger(track, settings) {
      if (track.type === 'music') {
        if (this.activeMusicId === track.id) {
          engine.stopMusic({ duration: settings.transitionDuration })
          this.activeMusicId = null
        } else {
          await engine.playMusic(track, {
            transition: settings.musicTransition,
            duration: settings.transitionDuration
          })
          this.activeMusicId = track.id
        }
      } else if (track.type === 'ambience') {
        if (engine.isAmbienceActive(track.id)) {
          engine.stopAmbience(track.id)
        } else {
          await engine.playAmbience(track)
        }
        this.activeAmbienceIds = engine.activeAmbienceIds
      } else {
        // one-shot
        await engine.playOneShot(track)
        this.flashingIds.push(track.id)
        setTimeout(() => {
          this.flashingIds = this.flashingIds.filter((id) => id !== track.id)
        }, 400)
      }
    },
    setTrackVolume(trackId, v) {
      engine.setTrackVolume(trackId, v)
    },
    stopAll() {
      engine.stopAll()
      this.activeMusicId = null
      this.activeAmbienceIds = []
      // Nero invece di disconnettere: la TV resta agganciata per la scena dopo
      if (this.activeCastId) this.blankCast()
    }
  }
})
