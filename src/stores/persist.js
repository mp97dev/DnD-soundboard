// Scritture su disco raggruppate e messe in fila.
//
// Il problema: gli @input dell'interfaccia sono continui, i salvataggi no.
// Misurato sulla build 1.0.3, una trascinata sola dello slider:
//   volume master   -> 39 POST /api/settings
//   volume traccia  -> 39 POST /api/library  (ognuno riscrive TUTTO index.json)
//   etichetta, 23 caratteri -> 24 POST /api/boards
// Su Electron sono 39 IPC + 39 riscritture; nel browser sono 39 richieste HTTP
// verso lo stesso host, che ne ammette 6 in parallelo — e una di quelle sei la
// tiene aperta l'<audio> che sta suonando.
//
// Peggio del volume: NON erano ordinate. Trentanove POST partiti insieme
// possono arrivare in qualunque ordine, quindi l'ultimo valore scritto su disco
// non è per forza l'ultimo scelto dall'utente: si lascia lo slider al 30% e si
// riapre l'app al 70%.
//
// Qui una modifica non scrive: segna che c'è da scrivere. Dopo WAIT_MS di
// quiete parte UNA scrittura, che legge lo stato di ADESSO. Se durante quella
// scrittura arrivano altre modifiche, se ne fa un'altra dopo — mai due insieme.
// Così l'ultima scrittura riflette per costruzione l'ultimo stato.
const WAIT_MS = 250

// Tutti i persister vivi, per poterli svuotare quando la pagina se ne va.
const all = new Set()

export function makePersister(write, waitMs = WAIT_MS) {
  let timer = null
  let running = false
  let dirty = false

  async function run() {
    // Una scrittura alla volta. Chi arriva mentre gira lascia detto che c'è
    // ancora da scrivere, e il ciclo qui sotto ci ripassa: è questo che rende
    // impossibile il sorpasso fra due salvataggi dello stesso file.
    if (running) {
      dirty = true
      return
    }
    running = true
    try {
      do {
        dirty = false
        await write()
      } while (dirty)
    } finally {
      running = false
    }
  }

  const persister = {
    schedule() {
      dirty = true
      if (timer) return // la finestra è già aperta: questa modifica entra in quella
      timer = setTimeout(() => {
        timer = null
        run()
      }, waitMs)
    },
    // Scrive subito quello che c'è in attesa. Serve a chi non può permettersi
    // la finestra di quiete: la pagina che si nasconde, un test che verifica
    // il disco subito dopo un'azione.
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      return run()
    }
  }
  all.add(persister)
  return persister
}

export function flushAll() {
  return Promise.all([...all].map((p) => p.flush()))
}

// Il persister di uno store, creato alla prima scrittura. Legato allo store e
// non al modulo: i test creano una pinia nuova per ogni caso, e un persister
// di modulo resterebbe agganciato allo store del caso precedente.
const byOwner = new WeakMap()

export function persisterFor(owner, write) {
  let p = byOwner.get(owner)
  if (!p) {
    p = makePersister(write)
    byOwner.set(owner, p)
  }
  return p
}

// Cambiare scheda, minimizzare o chiudere non deve perdere l'ultima modifica.
// 'visibilitychange' è quello che conta: scatta appena la scheda passa in
// secondo piano, molto prima della chiusura vera, quindi la scrittura ha tutto
// il tempo di arrivare. 'pagehide' è la rete di sicurezza per chi chiude di
// getto senza mai lasciare la scheda in secondo piano.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll()
  })
  window.addEventListener('pagehide', () => flushAll())
}
