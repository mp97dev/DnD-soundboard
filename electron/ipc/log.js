const { ipcMain, dialog, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const log = require('../../server/lib/log')

module.exports = function registerLogIpc() {
  // Salva il log dove dice l'utente e apre la cartella che lo contiene.
  // Installato dal .deb il log vive in ~/.config/dnd-soundboard/data/logs/:
  // una cartella nascosta dentro un'altra, che nessuno trova per caso e che è
  // scomoda da dettare a voce. Torna il percorso scelto, o null se annullato.
  ipcMain.handle('log:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Esporta log della sessione',
      defaultPath: path.join(os.homedir(), log.exportName()),
      filters: [{ name: 'Log', extensions: ['txt', 'log'] }]
    })
    if (canceled || !filePath) return null
    fs.writeFileSync(filePath, log.exportText(), 'utf-8')
    // Mostrare il file nel gestore file evita il passo successivo ("e adesso
    // dov'è finito?"), che è dove si perde chi non usa il terminale.
    shell.showItemInFolder(filePath)
    return filePath
  })

  // Il percorso del log, per poterlo mostrare quando il salvataggio non è
  // possibile (permessi, disco pieno) invece di lasciare l'utente a mani vuote.
  ipcMain.handle('log:path', () => log.logPath())

  // Il renderer non deve mai vedere un errore per colpa del logging: la
  // normalizzazione (livello, cap su scope/msg, prefisso ui:) e la garanzia di
  // non lanciare stanno in log.fromClient(), condivisa con la POST /api/log del
  // server LAN — così i due host non possono divergere.
  ipcMain.handle('log:write', (_e, entry) => {
    log.fromClient(entry)
    return true
  })
}
