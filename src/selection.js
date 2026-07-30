// Selezione multipla della tabella della libreria.
//
// Sta qui, fuori dal componente e senza dipendenze da Vue, perché è la parte
// che si sbaglia in silenzio: un intervallo shift calcolato sull'ordine
// sbagliato, o una selezione che continua a riferirsi a tracce che i filtri
// hanno nascosto, si notano solo quando l'azione di gruppo ha già toccato la
// traccia sbagliata. Così è verificabile senza aprire una finestra.

// Intervallo inclusivo fra due righe. Shift non sceglie fra ID ma fra
// POSIZIONI: l'ordine va passato ogni volta perché cambia con l'ordinamento
// delle colonne, e un intervallo calcolato sull'ordine di prima selezionerebbe
// righe lontane da quelle che l'utente vede fra il click e lo shift-click.
// Se l'ancora non è più a video (filtro cambiato in mezzo) l'intervallo si
// riduce alla sola riga cliccata: meglio selezionare una cosa in meno che
// duecento in più.
export function rangeIds(orderedIds, anchorId, targetId) {
  const to = orderedIds.indexOf(targetId)
  if (to === -1) return []
  const from = orderedIds.indexOf(anchorId)
  if (from === -1) return [targetId]
  return orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1)
}

// La selezione EFFETTIVA è sempre l'incrocio fra quello che è selezionato e
// quello che si vede, nell'ordine in cui si vede.
//
// Gli id restano nel Set anche quando i filtri li nascondono — cancellarli a
// ogni cambio di filtro vorrebbe dire perdere quaranta spunte perché si è
// scritta una lettera nella ricerca e poi cancellata — ma nessuna azione di
// gruppo li tocca finché non tornano a video. Il conto scritto nella barra e
// il conto delle tracce toccate sono quindi sempre lo stesso numero: è
// l'unica versione in cui «Elimina 40» non può cancellare qualcosa che in
// quel momento non è sullo schermo.
export function visibleSelection(selectedIds, orderedVisibleIds) {
  return orderedVisibleIds.filter((id) => selectedIds.has(id))
}

// Quante spunte sono rimaste fuori dai filtri attuali. Serve a dirlo
// nell'interfaccia: una selezione che c'è ma non conta, se non si vede, è una
// trappola alla prossima volta che si allarga il filtro.
export function hiddenSelectionCount(selectedIds, orderedVisibleIds) {
  return selectedIds.size - visibleSelection(selectedIds, orderedVisibleIds).length
}
