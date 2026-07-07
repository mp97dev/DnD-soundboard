const { ipcMain } = require('electron')
const fs = require('fs')
const { SETTINGS_FILE } = require('../paths')

const DEFAULTS = {
  version: 1,
  masterVolume: 0.8,
  musicTransition: 'crossfade',
  transitionDuration: 3000,
  castDeviceHost: null,
  castDeviceName: null
}

module.exports = function registerSettingsIpc() {
  ipcMain.handle('settings:get', () => {
    try {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) }
    } catch {
      return { ...DEFAULTS }
    }
  })

  ipcMain.handle('settings:save', (_e, settings) => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...DEFAULTS, ...settings }, null, 2))
    return true
  })
}
