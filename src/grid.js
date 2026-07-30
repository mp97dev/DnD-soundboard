// Geometria della griglia dei bottoni: dove cade il puntatore, quali celle
// sono occupate, se una collocazione ci sta.
//
// Sta fuori dai componenti e senza Vue perché è la parte che sbaglia senza
// dirlo. Un bottone lasciato mezzo fuori, o due impilati sulle stesse celle,
// non danno nessun errore: si scoprono a sessione in corso quando si cerca di
// premere quello sotto e risponde quello sopra. Qui è verificabile senza
// aprire una finestra.

// Riga/colonna (1-based) sotto un punto in pixel. Il rettangolo è quello del
// CONTENT box della griglia: il padding non fa parte delle celle, e usarlo
// sposterebbe il bersaglio di mezza cella vicino ai bordi.
export function cellFromPoint(rect, cols, rows, x, y) {
  const col = Math.floor(((x - rect.left) / rect.width) * cols) + 1
  const row = Math.floor(((y - rect.top) / rect.height) * rows) + 1
  return {
    row: Math.min(rows, Math.max(1, row)),
    col: Math.min(cols, Math.max(1, col))
  }
}

// Celle occupate, come Set di 'riga,colonna'. exceptId serve a chi si sta
// spostando: un bottone non collide con se stesso, se no non potrebbe mai
// muoversi di una cella sola restando in parte dov'era.
export function occupancy(buttons, exceptId = null) {
  const cells = new Set()
  for (const b of buttons) {
    if (b.id === exceptId) continue
    for (let r = b.row; r < b.row + b.rowSpan; r++) {
      for (let c = b.col; c < b.col + b.colSpan; c++) cells.add(`${r},${c}`)
    }
  }
  return cells
}

// Tutte le celle di una collocazione.
export function cellsOf({ row, col, rowSpan, colSpan }) {
  const out = []
  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) out.push(`${r},${c}`)
  }
  return out
}

// Dentro i bordi della griglia?
export function inBounds({ row, col, rowSpan, colSpan }, cols, rows) {
  return row >= 1 && col >= 1 && row + rowSpan - 1 <= rows && col + colSpan - 1 <= cols
}

// Ci sta: dentro i bordi E su celle libere. È l'unica domanda che il drop deve
// fare prima di scrivere.
export function fits(placement, cols, rows, occupied) {
  if (placement.rowSpan < 1 || placement.colSpan < 1) return false
  if (!inBounds(placement, cols, rows)) return false
  return !cellsOf(placement).some((k) => occupied.has(k))
}

// Riporta dentro la griglia una collocazione che sborda, senza cambiarne le
// dimensioni finché è possibile. Serve allo SPOSTAMENTO, dove trascinando
// oltre il bordo la cosa attesa è restare attaccati al bordo.
export function clampToBounds({ row, col, rowSpan, colSpan }, cols, rows) {
  const rs = Math.min(rowSpan, rows)
  const cs = Math.min(colSpan, cols)
  return {
    row: Math.min(Math.max(1, row), rows - rs + 1),
    col: Math.min(Math.max(1, col), cols - cs + 1),
    rowSpan: rs,
    colSpan: cs
  }
}

// Le otto maniglie. Le lettere dicono quali bordi muove ciascuna.
export const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

// Nuova collocazione trascinando una maniglia di dr righe e dc colonne.
//
// Il punto di tutto questo: le maniglie NORD e OVEST spostano il bordo di
// ancoraggio, non solo la dimensione. Prima la misura si cambiava solo dai due
// campi numerici, che agiscono su rowSpan/colSpan lasciando fermo l'angolo in
// alto a sinistra: un bottone poteva crescere solo verso destra e verso il
// basso. Tirando il bordo sinistro ci si aspetta che sia il bordo SINISTRO a
// muoversi, e che il destro resti dov'è.
//
// Lo span non scende sotto 1: oltre quel punto la maniglia si fermerebbe e
// basta, invece di ribaltare il bottone dall'altra parte.
export function resizeBy(start, handle, dr, dc) {
  let { row, col, rowSpan, colSpan } = start
  if (handle.includes('s')) {
    rowSpan = Math.max(1, rowSpan + dr)
  }
  if (handle.includes('n')) {
    // Il bordo inferiore è fisso: si muove quello superiore
    const bottom = row + rowSpan
    row = Math.min(bottom - 1, row + dr)
    rowSpan = bottom - row
  }
  if (handle.includes('e')) {
    colSpan = Math.max(1, colSpan + dc)
  }
  if (handle.includes('w')) {
    const right = col + colSpan
    col = Math.min(right - 1, col + dc)
    colSpan = right - col
  }
  return { row, col, rowSpan, colSpan }
}

// Prima cella libera abbastanza grande, scorrendo per righe. Torna null se
// non ce n'è: meglio non aggiungere niente che impilare.
export function findFreeCell(buttons, cols, rows, rowSpan = 1, colSpan = 2) {
  const occupied = occupancy(buttons)
  for (let r = 1; r <= rows - rowSpan + 1; r++) {
    for (let c = 1; c <= cols - colSpan + 1; c++) {
      if (fits({ row: r, col: c, rowSpan, colSpan }, cols, rows, occupied)) {
        return { row: r, col: c }
      }
    }
  }
  return null
}

// La cella libera più vicina a quella puntata, cercando a raggio crescente.
// Serve al drop: se si lascia la traccia mezzo sopra un bottone, mettere il
// nuovo accanto è quasi sempre quello che si voleva, e rifiutare e basta
// costringerebbe a mirare. Oltre maxRadius si rinuncia e il drop viene
// rifiutato per davvero.
export function nearestFree(target, span, cols, rows, occupied, maxRadius = 3) {
  const base = { ...target, ...span }
  if (fits(base, cols, rows, occupied)) return base
  for (let rad = 1; rad <= maxRadius; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        // solo il bordo del quadrato di raggio rad: l'interno è già stato visto
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue
        const cand = { row: target.row + dr, col: target.col + dc, ...span }
        if (fits(cand, cols, rows, occupied)) return cand
      }
    }
  }
  return null
}
