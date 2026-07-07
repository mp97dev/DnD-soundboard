import { defineStore } from 'pinia'
import { engine } from '../audio/engine'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    version: 1,
    masterVolume: 0.8,
    musicTransition: 'crossfade',
    transitionDuration: 3000,
    castDeviceHost: null,
    castDeviceName: null
  }),
  actions: {
    async load() {
      const s = await window.api.settings.get()
      Object.assign(this, s)
      engine.setMasterVolume(this.masterVolume)
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
