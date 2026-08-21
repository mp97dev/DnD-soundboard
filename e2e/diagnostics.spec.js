// Sonde d'ambiente e rapporto di sessione.
//
// Queste due cose sono difficili da provare "dal vivo": pactl non esiste su
// ogni macchina di sviluppo, e la cassa Bluetooth che scivola in HSP a metà
// partita non si riproduce a comando. Quindi si prova quello che si può
// davvero fissare — il parsing e il rendering — contro output veri di pactl.
const { test, expect } = require('@playwright/test')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { parseBluetoothProfile } = require('../server/lib/diagnostics')

// Output reale di `pactl -f json list cards` (PipeWire, Ubuntu 24) ridotto ai
// campi che leggiamo.
const cards = (activeProfile) => JSON.stringify([
  {
    index: 45,
    name: 'bluez_card.AC_37_43_1B_2C_3D',
    driver: 'module-bluez5-device.c',
    profiles: {
      'a2dp-sink-sbc': { description: 'High Fidelity Playback (A2DP Sink, codec SBC)', available: true },
      'headset-head-unit-msbc': { description: 'Headset Head Unit (HSP/HFP, codec mSBC)', available: true }
    },
    active_profile: activeProfile
  }
])

test('profilo Bluetooth: A2DP è alta fedeltà, HSP no', () => {
  const hifi = parseBluetoothProfile(cards('a2dp-sink-sbc'))
  expect(hifi.profile).toBe('a2dp-sink-sbc')
  expect(hifi.hifi).toBe(true)
  expect(hifi.card).toBe('bluez_card.AC_37_43_1B_2C_3D')

  // la stessa cassa dopo che qualcosa ha aperto il microfono
  const degraded = parseBluetoothProfile(cards('headset-head-unit-msbc'))
  expect(degraded.profile).toBe('headset-head-unit-msbc')
  expect(degraded.hifi).toBe(false)

  // anche il nome senza suffisso di codec (pactl più vecchie) va riconosciuto
  expect(parseBluetoothProfile(cards('a2dp-sink')).hifi).toBe(true)
})

test('profilo Bluetooth: senza cassa o con output illeggibile non esplode', () => {
  // pactl troppo vecchia per -f json: run() torna null
  expect(parseBluetoothProfile(null)).toBeNull()
  expect(parseBluetoothProfile('non è json')).toBeNull()
  // solo schede audio interne: nessuna bluez, niente da dire
  expect(parseBluetoothProfile(JSON.stringify([{ name: 'alsa_card.pci-0000_00_1b.0', active_profile: 'output:analog-stereo' }]))).toBeNull()
})

// Il rapporto è lo strumento con cui si legge una sessione andata storta: se
// la caduta a HSP non ci compare, la riga nel log non serve a niente.
test('rapporto di sessione: la caduta a HSP compare accanto agli stalli', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'soundboard-report-'))
  const logFile = path.join(tmp, 'soundboard.log')
  const day = '2026-08-21T20'
  fs.writeFileSync(logFile, [
    `${day}:00:00.000Z INFO  app avvio port=8080 node=24.0.0 platform=linux arch=x64`,
    `${day}:00:00.100Z INFO  env audio-server server=PulseAudio defaultSink=bluez_output.AC_37_43_1B_2C_3D.1 bluetooth=true profiloBluetooth=a2dp-sink-sbc altaFedelta=true`,
    `${day}:05:00.000Z INFO  ui:audio avvio traccia path=library/downloaded/x.mp3 kind=music volume=0.7`,
    `${day}:31:00.000Z WARN  health uscita audio cambiata profiloBluetoothPrima=a2dp-sink-sbc profiloBluetoothDopo=headset-head-unit-msbc perditaDiQualita=true`,
    `${day}:31:04.000Z WARN  ui:audio evento waiting path=library/downloaded/x.mp3`,
    `${day}:31:07.000Z WARN  ui:audio ricostruzione voce audio path=library/downloaded/x.mp3 attempt=1 resumeAt=1560 reason=stall backoffMs=500`,
    ''
  ].join('\n'))

  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'session-report.js'), logFile], { encoding: 'utf-8' })

  expect(out).toContain('a2dp-sink-sbc')
  expect(out).toContain('headset-head-unit-msbc')
  expect(out).toMatch(/qualità persa/)
  expect(out).toContain('mono 8-16 kHz')
  // e la ricostruzione della traccia resta visibile: sono i due fatti da
  // mettere uno accanto all'altro
  expect(out).toMatch(/x\.mp3/)

  fs.rmSync(tmp, { recursive: true, force: true })
})
