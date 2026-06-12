import { defineStore } from 'pinia'
import { engine } from '../audio/engine'
import { useSettingsStore } from './settings'

export const usePlaybackStore = defineStore('playback', {
  state: () => ({
    activeMusicId: null,
    activeAmbienceIds: [],
    flashingIds: [], // one-shot in flash
    loadingIds: [] // tracce in caricamento (apertura stream / decode one-shot)
  }),
  actions: {
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
    }
  }
})
