#!/usr/bin/env node
// Legge un log di sessione (vero o soak) e ne stampa il referto.
//
//   npm run session-report                 # trova da solo il log dell'installazione
//   npm run session-report -- <file.log>   # un file specifico (es. copiato dal PC di gioco)
//   npm run session-report -- <file.log> --verbose
//
// Il log è già leggibile a grep (docs/session-test-plan.md §5); questo script
// serve a rispondere alle domande che a grep costano mezz'ora dopo quattro ore
// di gioco: quante volte è caduta la TV e dopo quanto, quali tracce hanno
// stallato, se la memoria è cresciuta, se c'è stato un buco nella registrazione.
const fs = require('fs')
const os = require('os')
const path = require('path')

// ---- Individuazione del file ----
function defaultLogCandidates() {
  const name = 'DnD Soundboard'
  const home = os.homedir()
  const userData =
    process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', name)
      : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), name)
        : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), name)
  return [
    path.join(userData, 'data', 'logs', 'soundboard.log'),
    path.join(__dirname, '..', 'data', 'logs', 'soundboard.log')
  ]
}

// ---- Parsing ----
// Formato (server/lib/log.js): "<iso> <LEVEL> <scope> <messaggio> k=v k=v"
const LINE = /^(\S+) (DEBUG|INFO|WARN|ERROR)\s+(\S+) (.*)$/

// I valori con spazi sono quotati JSON: la tokenizzazione deve rispettarli.
function splitTokens(rest) {
  return rest.match(/[^\s"]*"(?:[^"\\]|\\.)*"|\S+/g) || []
}

function parseLine(line) {
  const m = LINE.exec(line)
  if (!m) return null
  const [, ts, level, scope, rest] = m
  const tokens = splitTokens(rest)
  const fields = {}
  const msgParts = []
  let inFields = false
  for (const tok of tokens) {
    const kv = /^([A-Za-z_][A-Za-z0-9_.]*)=(.*)$/.exec(tok)
    if (kv && (inFields || msgParts.length)) {
      inFields = true
      let v = kv[2]
      if (v.startsWith('"')) { try { v = JSON.parse(v) } catch { /* lascia grezzo */ } }
      fields[kv[1]] = v
    } else {
      msgParts.push(tok)
    }
  }
  return { ts, at: new Date(ts), level, scope, msg: msgParts.join(' '), fields, line }
}

// ---- Aiuti ----
const num = (v) => (v === undefined || v === '' ? null : Number(v))
const hhmm = (d) => (Number.isNaN(d?.getTime?.()) ? '??:??:??' : d.toISOString().slice(11, 19))
const dur = (sec) => {
  if (sec === null || Number.isNaN(sec)) return '?'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`
}
function table(rows) {
  if (!rows.length) return []
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? '').length)))
  return rows.map((r) => '  ' + r.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ').trimEnd())
}
const section = (title) => ['', title, '─'.repeat(title.length)]

// ---- Referto ----
function report(entries, { verbose }) {
  const out = []
  const first = entries[0]
  const last = entries[entries.length - 1]
  const spanSec = (last.at - first.at) / 1000

  const boots = entries.filter((e) => e.scope === 'app' && e.msg === 'avvio')
  out.push(...section('Sessione'))
  out.push(...table([
    ['periodo', `${first.ts.slice(0, 19).replace('T', ' ')} → ${last.ts.slice(11, 19)} (${dur(spanSec)})`],
    ['righe', `${entries.length}`],
    ['avvii dell\'app', `${boots.length}${boots.length > 1 ? '  ← riavviata durante il periodo' : ''}`],
    ['versione', boots[0]?.fields.appVersion ?? boots[0]?.fields.node ?? '?']
  ]))

  // Ambiente: la riga di riferimento per capire "com'era messa la macchina"
  const env = entries.filter((e) => e.scope === 'env')
  if (env.length) {
    out.push(...section('Ambiente'))
    out.push(...table(env.slice(-6).map((e) => [e.msg, Object.entries(e.fields).map(([k, v]) => `${k}=${v}`).join(' ')])))
  }

  // ---- Cast ----
  const losses = entries.filter((e) => e.msg === 'sessione cast persa')
  const reconnOk = entries.filter((e) => e.msg.startsWith('reconnect: riuscito'))
  const reconnGiveUp = entries.filter((e) => e.msg.startsWith('reconnect: rinuncio'))
  out.push(...section('Chromecast'))
  if (!losses.length) {
    out.push('  nessuna sessione persa')
  } else {
    out.push(...table([
      ['ora', 'rilevatore', 'uptime', 'contenuto', 'titolo'],
      ...losses.map((e) => [
        hhmm(e.at),
        e.fields.detector,
        dur(num(e.fields.uptimeSec)),
        e.fields.contentType ?? '?',
        (e.fields.title ?? '').slice(0, 32)
      ])
    ]))
    const ups = losses.map((e) => num(e.fields.uptimeSec)).filter((v) => v !== null)
    if (ups.length > 1) {
      const spread = Math.max(...ups) - Math.min(...ups)
      out.push('')
      out.push(`  uptime: min ${dur(Math.min(...ups))}, max ${dur(Math.max(...ups))}, scarto ${dur(spread)}`)
      // Il test decisivo del piano: cadute a intervalli simili con un'immagine
      // ferma sono la firma del receiver che va in Backdrop.
      const images = losses.filter((e) => String(e.fields.contentType).startsWith('image/'))
      const videos = losses.filter((e) => String(e.fields.contentType).startsWith('video/') || String(e.fields.contentType).includes('mpegurl'))
      out.push(`  immagini: ${images.length} cadute · video: ${videos.length} cadute`)
      if (images.length >= 2 && !videos.length && spread < 300) {
        out.push('  → cadono solo le IMMAGINI, a intervalli simili: ipotesi Backdrop CONFERMATA (§7 del piano)')
      } else if (videos.length && images.length) {
        out.push('  → cadono sia immagini che video: guarda la rete, non il receiver (§8 del piano)')
      }
    }
    out.push(`  riconnessioni riuscite: ${reconnOk.length}${reconnGiveUp.length ? ` · rinunce: ${reconnGiveUp.length} ← qui la TV è rimasta spenta` : ''}`)
  }

  // ---- Audio ----
  const byTrack = new Map()
  const bump = (p, key) => {
    const rec = byTrack.get(p) || { buffering: 0, stalli: 0, errori: 0, ricostruzioni: 0, rinunce: 0 }
    rec[key] += 1
    byTrack.set(p, rec)
  }
  for (const e of entries) {
    if (e.scope !== 'audio' && !e.scope.startsWith('ui:audio')) continue
    const p = e.fields.path ?? '?'
    // Distinzione che conta: 'waiting'/'stalled' all'avvio di una traccia sono
    // bufferizzazione normale; solo lo scadere del timeout è uno stallo vero.
    if (e.msg.startsWith('evento stalled') || e.msg.startsWith('evento waiting')) bump(p, 'buffering')
    else if (e.msg.startsWith('stream fermo')) bump(p, 'stalli')
    else if (e.msg.startsWith('errore elemento audio') || e.msg.startsWith('avvio fallito')) bump(p, 'errori')
    else if (e.msg.startsWith('ricostruzione voce')) bump(p, 'ricostruzioni')
    else if (e.msg.startsWith('troppi tentativi')) bump(p, 'rinunce')
  }
  const devicechange = entries.filter((e) => e.msg.startsWith('cambio dispositivo audio')).length
  const ctxChanges = entries.filter((e) => e.msg.startsWith('stato AudioContext'))
  out.push(...section('Audio'))
  if (!byTrack.size) {
    out.push('  nessuno stallo, errore o ricostruzione')
  } else {
    const rows = [...byTrack.entries()].sort((a, b) =>
      (b[1].errori + b[1].ricostruzioni) - (a[1].errori + a[1].ricostruzioni))
    out.push(...table([
      ['traccia', 'buffering', 'stalli', 'errori', 'ricostr.', 'rinunce'],
      ...rows.map(([p, r]) => [p.split('/').pop().slice(0, 40), r.buffering, r.stalli, r.errori, r.ricostruzioni, r.rinunce])
    ]))
    out.push('  buffering = attese normali all\'avvio di una traccia; stalli = timeout scaduto, la voce è stata ricostruita')
    const rinunce = rows.filter(([, r]) => r.rinunce)
    if (rinunce.length) out.push('  → una traccia con "rinunce" è rimasta MUTA fino a un riavvio: è il guasto peggiore')
  }
  out.push(`  cambi di dispositivo audio: ${devicechange}`)
  const nonRunning = ctxChanges.filter((e) => e.fields.state && e.fields.state !== 'running')
  if (nonRunning.length) out.push(`  AudioContext uscito da 'running' ${nonRunning.length} volte (${nonRunning.map((e) => hhmm(e.at)).join(', ')})`)

  // ---- Battiti di salute ----
  const beatsUi = entries.filter((e) => e.scope === 'ui:health')
  const beatsHost = entries.filter((e) => e.scope === 'health')
  out.push(...section('Salute nel tempo'))
  if (!beatsUi.length && !beatsHost.length) {
    out.push('  nessun battito nel log: versione precedente all\'introduzione del battito, oppure sessione troppo breve')
  } else {
    const trend = (list, key) => {
      const vals = list.map((e) => num(e.fields[key])).filter((v) => v !== null && !Number.isNaN(v))
      if (vals.length < 2) return null
      return { primo: vals[0], ultimo: vals[vals.length - 1], max: Math.max(...vals) }
    }
    const rows = [['misura', 'inizio', 'fine', 'max']]
    const heap = trend(beatsUi, 'heapMB')
    if (heap) rows.push(['heap renderer (MB)', heap.primo, heap.ultimo, heap.max])
    const rss = trend(beatsHost, 'rssMB')
    if (rss) rows.push(['RSS host (MB)', rss.primo, rss.ultimo, rss.max])
    // Il primo battito cade in pieno avvio (finestra che si apre, moduli che
    // si caricano): quel ritardo dell'event loop non dice niente sulla sessione.
    const loop = trend(beatsHost.slice(1), 'loopDelayMs')
    if (loop) rows.push(['ritardo event loop (ms)', loop.primo, loop.ultimo, loop.max])
    out.push(...table(rows))
    if (heap && heap.ultimo > heap.primo * 2 && heap.ultimo - heap.primo > 100) {
      out.push('  → l\'heap del renderer è più che raddoppiato: sospetta perdita di memoria, allega il log')
    }
    if (loop && loop.max > 100) {
      out.push(`  → l'event loop dell'host ha ritardato fino a ${loop.max} ms: in quei momenti l'audio poteva scattare`)
    }
    const unhealthy = beatsUi.filter((e) => e.level === 'WARN')
    out.push(`  battiti: ${beatsUi.length} renderer · ${beatsHost.length} host · non in salute: ${unhealthy.length}`)
    for (const e of unhealthy.slice(0, verbose ? 100 : 5)) {
      out.push(`   ${hhmm(e.at)}  muti=${e.fields.muti ?? '?'} ctx=${e.fields.ctxState} voci=${e.fields.voices} ${verbose ? (e.fields.dettaglio ?? '') : ''}`)
    }
  }

  // ---- Buchi e problemi del log stesso ----
  const droppedLines = entries
    .filter((e) => e.msg.startsWith('coda piena'))
    .reduce((n, e) => n + (num(e.fields.dropped) || 0), 0)

  // La soglia del "buco" dipende da quanto spesso batte il cuore: con battiti
  // ogni minuto tre minuti di silenzio sono un'anomalia, con battiti ogni dieci
  // sarebbero la norma. Senza battiti si resta prudenti (5 minuti).
  const beatTimes = beatsHost.concat(beatsUi).map((e) => e.at.getTime()).sort((a, b) => a - b)
  const beatDeltas = beatTimes.slice(1).map((t, i) => (t - beatTimes[i]) / 1000).filter((d) => d > 0)
  const medianBeat = beatDeltas.length
    ? beatDeltas.sort((a, b) => a - b)[Math.floor(beatDeltas.length / 2)]
    : null
  const gapThreshold = medianBeat ? Math.max(180, medianBeat * 3) : 300

  const gaps = []
  for (let i = 1; i < entries.length; i++) {
    const delta = (entries[i].at - entries[i - 1].at) / 1000
    if (delta > gapThreshold) gaps.push([hhmm(entries[i - 1].at), hhmm(entries[i].at), dur(delta)])
  }
  if (droppedLines || gaps.length) {
    out.push(...section('Buchi nella registrazione'))
    if (droppedLines) out.push(`  ${droppedLines} righe perse per coda piena (disco lento)`)
    if (gaps.length) {
      out.push(`  silenzi oltre ${dur(gapThreshold)} (battito ogni ${dur(medianBeat ?? 60)}):`)
      out.push(...table([['da', 'a', 'durata'], ...gaps.slice(0, verbose ? gaps.length : 10)]))
      if (!verbose && gaps.length > 10) out.push(`  … e altri ${gaps.length - 10} (--verbose per vederli tutti)`)
      out.push('  → un buco lungo con il battito attivo = processo fermo (sospensione, freeze o crash)')
    }
  }

  // ---- Errori non ancora classificati ----
  const errors = entries.filter((e) => e.level === 'ERROR')
  if (errors.length) {
    out.push(...section(`Errori (${errors.length})`))
    const grouped = new Map()
    for (const e of errors) grouped.set(e.msg, (grouped.get(e.msg) || 0) + 1)
    out.push(...table([...grouped.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => [`${n}×`, m])))
    if (verbose) out.push(...errors.map((e) => '  ' + e.line))
  }

  return out
}

function main() {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const explicit = args.find((a) => !a.startsWith('--'))
  const file = explicit || defaultLogCandidates().find((p) => fs.existsSync(p))
  if (!file || !fs.existsSync(file)) {
    console.error('Log non trovato. Percorsi provati:')
    for (const p of defaultLogCandidates()) console.error('  ' + p)
    console.error('\nPassa il file esplicitamente: npm run session-report -- /percorso/soundboard.log')
    process.exit(1)
  }

  // Il .1 (rotazione a 2 MB) viene letto per primo: senza, di una sessione
  // lunga si analizzerebbe solo la coda.
  const parts = []
  if (fs.existsSync(`${file}.1`)) parts.push(fs.readFileSync(`${file}.1`, 'utf-8'))
  parts.push(fs.readFileSync(file, 'utf-8'))

  const entries = parts.join('').split('\n').map(parseLine).filter(Boolean)
  if (!entries.length) {
    console.error(`Nessuna riga riconosciuta in ${file}`)
    process.exit(1)
  }
  console.log(`File: ${file}${parts.length > 1 ? ' (+ .1)' : ''}`)
  console.log(report(entries, { verbose }).join('\n'))
}

if (require.main === module) main()
module.exports = { parseLine, report }
