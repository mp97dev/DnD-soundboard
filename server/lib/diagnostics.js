// Diagnostica d'ambiente: una fotografia dei fattori che influenzano la
// stabilità di audio e cast, loggata una volta sola all'avvio. Ogni sonda è
// isolata dalle altre: un comando assente o un permesso negato non deve mai
// far perdere le informazioni raccolte dalle sonde successive, né bloccare
// l'avvio del server/dell'app.
const os = require('os')
const fs = require('fs')
const { spawn } = require('child_process')
const log = require('./log')

const env = log.child('env')

// I comandi di sistema (pactl, iw) possono restare appesi se l'audio/WiFi
// stack è in uno stato strano: un timeout basso evita che una sonda
// diagnostica ritardi l'avvio più della sonda stessa vale la pena aspettare.
const PROBE_TIMEOUT_MS = 2000

// Esegue un comando con timeout esplicito, cattura solo stdout (stderr non
// interessa: qui vogliamo il dato, non diagnosticare il comando). Non
// rigetta mai: chi chiama riceve null e decide come loggare "non disponibile".
function run(cmd, args) {
  return new Promise((resolve) => {
    let out = ''
    let done = false
    let child
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill() } catch { /* già morto o mai partito */ }
      resolve(null)
    }, PROBE_TIMEOUT_MS)
    try {
      // LC_ALL=C: pactl traduce le etichette del suo output. Su una Ubuntu in
      // italiano "Active Profile" diventa "Profilo attivo", e una sonda che
      // cerca l'etichetta inglese smette di trovare niente proprio sulle
      // macchine di chi non ha l'inglese — cioè quelle di chi ci gioca.
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' } })
    } catch {
      clearTimeout(timer)
      resolve(null)
      return
    }
    child.stdout.on('data', (d) => { out += d })
    // ENOENT (comando non installato) arriva qui, non come 'close' con codice
    child.on('error', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(code === 0 ? out : null)
    })
  })
}

// Estrae "Chiave: valore" da un output tipo `pactl info` (una riga per campo).
function extractField(text, label) {
  if (!text) return null
  const line = text.split('\n').find((l) => l.trim().startsWith(label))
  if (!line) return null
  return line.slice(line.indexOf(':') + 1).trim()
}

async function logDistro() {
  try {
    const text = fs.readFileSync('/etc/os-release', 'utf-8')
    const match = text.match(/^PRETTY_NAME="?([^"\n]*)"?/m)
    env.info('distro', { name: match ? match[1] : 'sconosciuta' })
  } catch {
    env.info('distro', { name: 'non disponibile' })
  }
}

// Il profilo Bluetooth attivo, ricavato dal JSON di pactl.
//
// Perché non basta sapere che il sink è bluez: A2DP e HSP/HFP sono due mondi.
// A2DP è stereo a 44.1 kHz e suona; HSP/HFP è mono a 8-16 kHz, nato per il
// telefono, e la musica ci esce impastata e a scatti. Il passaggio da uno
// all'altro lo decide il sistema, NON l'utente: basta che un processo qualsiasi
// apra il microfono — una scheda del browser su una videochiamata, un sito che
// chiede il permesso — e la cassa scivola in HSP con la musica in corso.
// Nessun evento arriva all'app: la musica peggiora e basta.
function parseBluetoothProfile(cardsJson) {
  try {
    const cards = JSON.parse(cardsJson)
    const bt = cards.find((c) => /bluez/i.test(c.name || ''))
    if (!bt) return null
    const profile = bt.active_profile || 'sconosciuto'
    return {
      card: bt.name,
      profile,
      // I nomi veri sono 'a2dp-sink', 'a2dp-sink-sbc', 'a2dp-sink-aac',
      // 'headset-head-unit', 'headset-head-unit-msbc'…: si guarda il prefisso.
      hifi: /^a2dp/i.test(profile)
    }
  } catch {
    return null
  }
}

// Fotografia dell'uscita audio. Tutto opzionale: su una macchina senza pactl
// (Windows, container) si torna con { pactl: 'non disponibile' } e nessuna
// sonda si lamenta.
async function probeAudioSink() {
  const info = await run('pactl', ['info'])
  if (!info) return { pactl: 'non disponibile' }
  const defaultSink = extractField(info, 'Default Sink') || 'sconosciuto'
  const snap = {
    server: extractField(info, 'Server Name') || 'sconosciuto',
    defaultSink,
    // "bluez" nel nome del sink = output su altoparlante/soundbar Bluetooth:
    // è la causa più comune di dropout audio, va distinta da un sink cablato
    bluetooth: /bluez/i.test(defaultSink)
  }
  if (!snap.bluetooth) return snap
  // -f json invece del testo: l'output a etichette cambia fra versioni di
  // pactl oltre che con la lingua, il JSON no. Se questa pactl è troppo
  // vecchia per -f json, run() torna null e si resta al dato di sopra.
  const bt = parseBluetoothProfile(await run('pactl', ['-f', 'json', 'list', 'cards']))
  return bt ? { ...snap, profiloBluetooth: bt.profile, altaFedelta: bt.hifi } : snap
}

async function logAudioServer() {
  const snap = await probeAudioSink()
  env.info('audio-server', snap)
}

async function logWifiPowerSave() {
  let ifaces
  try {
    ifaces = fs.readdirSync('/sys/class/net')
  } catch {
    env.info('wifi-power-save', { status: 'non disponibile' })
    return
  }
  const wireless = ifaces.filter((i) => fs.existsSync(`/sys/class/net/${i}/wireless`))
  if (!wireless.length) {
    env.info('wifi-power-save', { status: 'nessuna interfaccia wireless' })
    return
  }
  // Questa macchina fa da server HTTP per il media che il Chromecast scarica:
  // se il WiFi va in power save (default Ubuntu su batteria), è la TV a
  // vedersi affamare lo stream, non solo questo processo a "sentirsi lento"
  await Promise.all(
    wireless.map(async (iface) => {
      const out = await run('iw', ['dev', iface, 'get', 'power_save'])
      env.info('wifi-power-save', {
        iface,
        powerSave: out ? out.trim() : 'iw non disponibile'
      })
    })
  )
}

async function logEnvironment() {
  try {
    const cpus = os.cpus()
    env.info('sistema', {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      totalMemGB: (os.totalmem() / 1024 ** 3).toFixed(1),
      cpuCount: cpus.length,
      cpuModel: (cpus[0] && cpus[0].model) || 'sconosciuto'
    })
  } catch {
    env.info('sistema', { status: 'non disponibile' })
  }

  if (process.platform === 'linux') {
    // Ogni sonda è già "a prova di eccezione" al suo interno; il catch qui è
    // solo una seconda rete di sicurezza contro un difetto imprevisto
    await logDistro().catch(() => {})
    await logAudioServer().catch(() => {})
    await logWifiPowerSave().catch(() => {})
  }

  try {
    // L'IP LAN è quello che finisce negli URL dei media mandati al
    // Chromecast: utile riga da riguardare quando una sessione salta
    const lanIp = require('./cast').lanIp()
    env.info('rete', { lanIp: lanIp || 'non disponibile' })
  } catch {
    env.info('rete', { lanIp: 'non disponibile' })
  }
}

module.exports = { logEnvironment, probeAudioSink, parseBluetoothProfile }
