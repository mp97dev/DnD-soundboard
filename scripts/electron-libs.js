// Electron non parte se mancano le librerie di sistema di Chromium (libnss3,
// libnspr4, libasound2): Playwright riporta solo "Process failed to launch!",
// che non dice niente a chi lo legge. Qui stanno le due cose che servono per
// trasformarlo in un messaggio utile: come usare le librerie estratte in locale
// (scripts/fetch-electron-libs.sh) e come scoprire quali mancano davvero.
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const LOCAL_LIBS = path.join(ROOT, '.electron-libs', 'extracted', 'usr', 'lib', `${os.arch() === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu`)

// Ambiente da passare a electron.launch(): se le librerie estratte esistono le
// aggiunge in testa a LD_LIBRARY_PATH, altrimenti restituisce l'ambiente com'è.
function withElectronLibs(env = process.env) {
  if (process.platform !== 'linux' || !fs.existsSync(LOCAL_LIBS)) return env
  return {
    ...env,
    LD_LIBRARY_PATH: env.LD_LIBRARY_PATH ? `${LOCAL_LIBS}:${env.LD_LIBRARY_PATH}` : LOCAL_LIBS
  }
}

// Librerie che il binario Electron cerca e non trova. Lista vuota = il problema
// è un altro (e va detto, invece di mandare l'utente a caccia di librerie).
function missingLibraries() {
  if (process.platform !== 'linux') return []
  const bin = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron')
  if (!fs.existsSync(bin)) return []
  try {
    const out = execFileSync('ldd', [bin], { encoding: 'utf-8', env: withElectronLibs() })
    return [...new Set(
      out.split('\n')
        .filter((l) => l.includes('not found'))
        .map((l) => l.trim().split(' ')[0])
    )]
  } catch {
    return [] // ldd assente o binario illeggibile: nessuna diagnosi da dare
  }
}

// Messaggio da stampare quando il lancio fallisce. Dice cosa manca e le due
// strade per rimediare, quella con sudo e quella senza.
function launchFailureHelp() {
  const missing = missingLibraries()
  const lines = ['', 'Electron non è riuscito a partire.']
  if (!missing.length) {
    lines.push(
      '',
      'Non risultano librerie mancanti: il problema è altrove.',
      'Prova a lanciare l\'app a mano per vedere l\'errore vero:',
      '  npx electron .'
    )
    return lines.join('\n')
  }
  lines.push(
    '',
    `Mancano le librerie di sistema di Chromium: ${missing.join(', ')}`,
    'Succede su installazioni minime (WSL2, container, immagini server).',
    '',
    'Con sudo (soluzione definitiva):',
    '  sudo apt-get install -y libnss3 libnspr4 libasound2t64',
    '',
    'Senza sudo (le estrae nel progetto, in .electron-libs/):',
    '  npm run fetch:electron-libs',
    '',
    'Dopo l\'una o l\'altra, rilancia lo stesso comando.'
  )
  return lines.join('\n')
}

// Controllo PRIMA di lanciare. Serve perché il fallimento di
// electron.launch() non arriva come promise rifiutata: Playwright lo solleva
// come eccezione non catturata e il processo muore con lo stack di
// playwright-core, dove la causa vera non compare da nessuna parte.
// Restituisce il messaggio d'aiuto se il lancio è destinato a fallire, null se
// non risultano problemi noti.
function preflight() {
  return missingLibraries().length ? launchFailureHelp() : null
}

module.exports = { withElectronLibs, missingLibraries, launchFailureHelp, preflight, LOCAL_LIBS }
