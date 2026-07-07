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
    castError: null
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
      } catch (e) {
        this.castError = `Cast fallito: ${e.message}`
      }
    },
    async stopCast() {
      this.activeCastId = null
      try {
        await window.api.cast.stop()
      } catch { /* la TV può essere già spenta */ }
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
      if (this.activeCastId) this.stopCast()
    }
  }
})
