const { ipcMain } = require('electron')
const log = require('../../server/lib/log')

const LEVELS = ['debug', 'info', 'warn', 'error']

module.exports = function registerLogIpc() {
  // Il renderer non deve mai vedere un errore per colpa del logging: qualunque
  // input malformato viene normalizzato o ignorato, mai rilanciato.
  ipcMain.handle('log:write', (_e, entry) => {
    const { level, scope, msg, fields } = entry || {}
    const lvl = LEVELS.includes(level) ? level : 'info'
    // Prefisso ui: per distinguere a colpo d'occhio le righe del renderer da quelle del main process
    const scopedName = `ui:${String(scope ?? '').slice(0, 200)}`
    const text = String(msg ?? '').slice(0, 500)
    const safeFields = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : undefined
    log[lvl](scopedName, text, safeFields)
    return true
  })
}
