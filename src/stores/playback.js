import { defineStore } from 'pinia'
import { engine } from '../audio/engine'
import { useSettingsStore } from './settings'
import { t } from '../i18n'

export const usePlaybackStore = defineStore('playback', {
  state: () => ({
    activeMusicId: null,
    activeAmbienceIds: [],
    flashingIds: [], // one-shot in flash
    loadingIds: [], // tracce in caricamento (apertura stream / decode one-shot)
    activeCastId: null, // visual attualmente in cast sul Chromecast
    castError: null,
    castReconnecting: false, // il backend sta riagganciando la TV persa
    castConnected: false, // sessione TV viva (anche se a schermo nero)
    audioError: null
  }),
  actions: {
    // Collega il motore audio al gestore d'errore della UI: senza questo, un
    // rebuild esausto o un play() fallito nell'engine restano invisibili
    // (loggati ma muti in interfaccia). Chiamata una volta sola dal setup di
    // App.vue, non lazy nel trigger: qui non dipende da un'azione utente e
    // deve essere pronta prima del primo click.
    initAudio() {
      // count > 1 = più voci cadute a breve distanza: è saltata l'uscita audio,
      // non un file. Nominare una traccia a caso (l'ultima arrivata) sarebbe
      // fuorviante proprio nel caso in cui l'utente ha più bisogno di capire.
      // L'engine manda un codice più i suoi parametri: la frase si compone qui,
      // dove si sa la lingua scelta. Senza questo passaggio la parte tecnica
      // arriverebbe in italiano dentro una cornice inglese.
      engine.setErrorHandler(({ path, code, params, count }) => {
        const detail = code ? t(`playback.engine.${code}`, params ?? {}) : path ?? ''
        this.audioError = count > 1
          ? t('playback.audioStopped', { message: detail }, count)
          : t('playback.audioFailed', { detail })
      })
    },
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
    // Mostra il visual sul Chromecast selezionato (se c'è) e sempre sulla
    // pagina /viewer (host può essere null: solo-viewer, nessuna TV agganciata).
    async castVisual(visual) {
      const settings = useSettingsStore()
      this.castError = null
      try {
        const res = await window.api.cast.show({
          host: settings.castDeviceHost,
          path: visual.mediaPath,
          title: visual.title,
          visualId: visual.id
        })
        this.activeCastId = res.visualId ?? visual.id
        this.castConnected = !!res.casting
      } catch (e) {
        this.castError = t('playback.castFailed', { error: e.message })
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
    // Poll periodico. Lo stato del cast lo tiene l'host — è lui a sapere se la
    // sessione è viva, se sta riagganciando e quale visual è su schermo (TV o
    // tablet che sia): qui lo si ricopia e basta. Quando la regola stava anche
    // di qua, il renderer doveva leggersi le impostazioni per sapere se c'era
    // una TV, e perdeva il visual attivo ad ogni reload della pagina mentre TV
    // e tablet continuavano tranquillamente a mostrarlo.
    async syncCastStatus() {
      try {
        const st = await window.api.cast.status()
        this.castReconnecting = !!st.reconnecting
        this.castConnected = !!st.casting
        this.activeCastId = st.visualId ?? null
      } catch { /* backend non raggiungibile: lascia lo stato com'è */ }
    },
    async trigger(track) {
      const settings = useSettingsStore()
      if (!track || track.missing) return
      if (this.loadingIds.includes(track.id)) return // anti doppio-click

      this.audioError = null
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
