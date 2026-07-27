const { ipcMain } = require('electron')
const log = require('../../server/lib/log')

module.exports = function registerLogIpc() {
  // Il renderer non deve mai vedere un errore per colpa del logging: la
  // normalizzazione (livello, cap su scope/msg, prefisso ui:) e la garanzia di
  // non lanciare stanno in log.fromClient(), condivisa con la POST /api/log del
  // server LAN — così i due host non possono divergere.
  ipcMain.handle('log:write', (_e, entry) => {
    log.fromClient(entry)
    return true
  })
}
