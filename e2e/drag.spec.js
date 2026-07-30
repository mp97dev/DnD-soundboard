// Il trascinamento è il cuore dell'edit e non aveva copertura: le tre strade
// (traccia sulla griglia, traccia su una cartella, cartella dentro un'altra)
// si rompono in silenzio, perché un drop che non fa niente sembra un drop
// fatto male dall'utente. Questi test esistono soprattutto per la riscrittura
// dell'interazione su Pointer Events: sono il paragone contro cui misurarla.
//
// Ogni asserzione guarda il FILE su disco, non solo lo schermo: un bottone
// disegnato ma non salvato sparisce al riavvio, ed è il guasto che a video
// non si vede.
const { test, expect } = require('@playwright/test')
const { launchApp } = require('./helpers')

const LIBRARY = {
  folders: [
    { id: 'f1', name: 'Ravenloft', parentId: null, color: null },
    { id: 'f2', name: 'Campagna 3', parentId: null, color: null }
  ],
  tracks: [
    {
      id: 't1', version: 1, title: 'Marcia', type: 'music', volume: 1,
      audioPath: 'library/downloaded/a.mp3', thumbnailPath: null,
      tags: [], folderIds: [], source: { type: 'local' }
    },
    {
      id: 't2', version: 1, title: 'Pioggia', type: 'ambience', volume: 1,
      audioPath: 'library/downloaded/b.mp3', thumbnailPath: null,
      tags: [], folderIds: [], source: { type: 'local' }
    }
  ]
}

async function openEdit(page) {
  await page.getByRole('button', { name: /Edit/ }).click()
  await page.waitForSelector('.sidebar')
}

// Celle occupate da più di un bottone. Zero è l'unica risposta accettabile:
// il bottone che finisce sotto resta nel file, tiene le sue celle e non si
// riesce più a selezionare.
function overlappingCells(buttons) {
  const seen = new Set()
  let overlaps = 0
  for (const b of buttons) {
    for (let r = b.row; r < b.row + b.rowSpan; r++) {
      for (let c = b.col; c < b.col + b.colSpan; c++) {
        const k = `${r},${c}`
        if (seen.has(k)) overlaps++
        seen.add(k)
      }
    }
  }
  return overlaps
}

test('trascinamento: una traccia dalla libreria diventa un bottone salvato', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  await page.getByRole('button', { name: /Nuova board/ }).click()
  await page.getByPlaceholder('Nome board').fill('Test')
  await page.getByRole('button', { name: 'Crea' }).click()
  await openEdit(page)

  expect(readBoards()[0].buttons).toHaveLength(0)

  await page.locator('.sidebar .track', { hasText: 'Marcia' }).first()
    .dragTo(page.locator('.edit-grid'))

  await expect(page.locator('.btn-wrapper')).toHaveCount(1)
  await expect.poll(() => readBoards()[0].buttons.length).toBe(1)
  expect(readBoards()[0].buttons[0].trackId).toBe('t1')

  await app.close()
})

test('trascinamento: una traccia su una cartella ci viene aggiunta, non spostata', async () => {
  const { app, page, readLibrary } = await launchApp({ library: LIBRARY })
  await page.getByRole('button', { name: /Nuova board/ }).click()
  await page.getByPlaceholder('Nome board').fill('Test')
  await page.getByRole('button', { name: 'Crea' }).click()
  await openEdit(page)

  const pioggia = page.locator('.sidebar .track', { hasText: 'Pioggia' }).first()
  await pioggia.dragTo(page.locator('.sidebar .folder-row', { hasText: 'Ravenloft' }).first())
  await expect
    .poll(() => readLibrary().tracks.find((t) => t.id === 't2').folderIds)
    .toEqual(['f1'])

  // La collocazione è multipla: la seconda cartella si AGGIUNGE alla prima.
  // Se qui comparisse solo f2 vorrebbe dire che il drop sposta, e il brano
  // condiviso fra due campagne smetterebbe di essere condiviso.
  await pioggia.dragTo(page.locator('.sidebar .folder-row', { hasText: 'Campagna 3' }).first())
  await expect
    .poll(() => readLibrary().tracks.find((t) => t.id === 't2').folderIds.slice().sort())
    .toEqual(['f1', 'f2'])

  await app.close()
})

test('trascinamento: una cartella dentro un\'altra la riparenta', async () => {
  const { app, page, readLibrary } = await launchApp({ library: LIBRARY })
  await page.getByRole('button', { name: /Nuova board/ }).click()
  await page.getByPlaceholder('Nome board').fill('Test')
  await page.getByRole('button', { name: 'Crea' }).click()
  await openEdit(page)

  await page.locator('.sidebar .folder-row', { hasText: 'Campagna 3' }).first()
    .dragTo(page.locator('.sidebar .folder-row', { hasText: 'Ravenloft' }).first())

  await expect
    .poll(() => readLibrary().folders.find((f) => f.id === 'f2').parentId)
    .toBe('f1')

  await app.close()
})

// Era un test.fail: prima della riscrittura un drop sopra un bottone
// esistente ne impilava due sulle stesse celle. Ora la cella occupata viene
// scansata verso la libera più vicina, e questo è il test che lo tiene fermo.
test('trascinamento: un drop su una cella occupata non deve sovrapporre', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  await page.getByRole('button', { name: /Nuova board/ }).click()
  await page.getByPlaceholder('Nome board').fill('Test')
  await page.getByRole('button', { name: 'Crea' }).click()
  await openEdit(page)

  const marcia = page.locator('.sidebar .track', { hasText: 'Marcia' }).first()
  await marcia.dragTo(page.locator('.edit-grid'))
  await expect(page.locator('.btn-wrapper')).toHaveCount(1)

  // Drop esattamente sopra il bottone che c'è già
  await page.locator('.sidebar .track', { hasText: 'Pioggia' }).first()
    .dragTo(page.locator('.btn-wrapper').first())
  await expect.poll(() => readBoards()[0].buttons.length).toBe(2)

  expect(overlappingCells(readBoards()[0].buttons)).toBe(0)

  await app.close()
})

// ---- Ridimensionamento a trascinamento (nuovo nella fase 7) ----
// Prima la misura si cambiava solo dai due campi numerici, che agiscono su
// rowSpan/colSpan tenendo fermo l'angolo in alto a sinistra: un bottone poteva
// crescere solo verso destra e verso il basso. Questi test guardano proprio
// quello che prima era impossibile.

async function makeButton(page, readBoards) {
  await page.getByRole('button', { name: /Nuova board/ }).click()
  await page.getByPlaceholder('Nome board').fill('Test')
  await page.getByRole('button', { name: 'Crea' }).click()
  await openEdit(page)
  await page.locator('.sidebar .track', { hasText: 'Marcia' }).first()
    .dragTo(page.locator('.edit-grid'))
  await expect.poll(() => readBoards()[0].buttons.length).toBe(1)
  // selezionato: le maniglie compaiono solo sul bottone selezionato
  await page.locator('.btn-wrapper').first().click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.handle')).toHaveCount(8)
  return readBoards()[0].buttons[0]
}

// Trascina una maniglia di (dx, dy) pixel con veri eventi di puntatore.
async function dragHandle(page, handle, dx, dy) {
  const h = page.locator(`.handle.h-${handle}`)
  const box = await h.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

test('ridimensionamento: la maniglia ovest fa crescere il bottone verso SINISTRA', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  const before = await makeButton(page, readBoards)
  const grid = await page.locator('.edit-grid').boundingBox()
  const cellW = grid.width / 12 // board di default: 12 colonne

  await dragHandle(page, 'w', -cellW * 2, 0)

  await expect.poll(() => readBoards()[0].buttons[0].col).toBeLessThan(before.col)
  const after = readBoards()[0].buttons[0]
  // il bordo DESTRO non si è mosso: è cresciuto a sinistra, non traslato
  expect(after.col + after.colSpan).toBe(before.col + before.colSpan)
  expect(after.colSpan).toBeGreaterThan(before.colSpan)

  await app.close()
})

test('ridimensionamento: la maniglia nord fa crescere il bottone verso l\'ALTO', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  const before = await makeButton(page, readBoards)
  const grid = await page.locator('.edit-grid').boundingBox()
  const cellH = grid.height / 8 // board di default: 8 righe

  await dragHandle(page, 'n', 0, -cellH * 2)

  await expect.poll(() => readBoards()[0].buttons[0].row).toBeLessThan(before.row)
  const after = readBoards()[0].buttons[0]
  expect(after.row + after.rowSpan).toBe(before.row + before.rowSpan)

  await app.close()
})

test('annulla: Ctrl+Z rimette il bottone come stava', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  const before = await makeButton(page, readBoards)
  const grid = await page.locator('.edit-grid').boundingBox()

  await dragHandle(page, 'e', (grid.width / 12) * 2, 0)
  await expect.poll(() => readBoards()[0].buttons[0].colSpan).toBeGreaterThan(before.colSpan)

  await page.keyboard.press('Control+z')
  await expect.poll(() => readBoards()[0].buttons[0].colSpan).toBe(before.colSpan)

  // e si può rifare
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => readBoards()[0].buttons[0].colSpan).toBeGreaterThan(before.colSpan)

  await app.close()
})

test('tastiera: le frecce spostano il bottone selezionato', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  const before = await makeButton(page, readBoards)

  await page.keyboard.press('ArrowDown')
  await expect.poll(() => readBoards()[0].buttons[0].row).toBe(before.row + 1)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => readBoards()[0].buttons[0].col).toBe(before.col + 1)

  await app.close()
})

// ---- Regressioni trovate in revisione ----

test('tastiera: un campo di testo a fuoco si tiene i suoi tasti', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  const before = await makeButton(page, readBoards)

  // Il cursore nella ricerca della libreria: le frecce muovono il CURSORE,
  // non il bottone selezionato.
  const search = page.locator('.sidebar input.search')
  await search.fill('mar')
  await search.press('ArrowLeft')
  await search.press('ArrowLeft')
  await page.waitForTimeout(200)
  let after = readBoards()[0].buttons[0]
  expect({ row: after.row, col: after.col }).toEqual({ row: before.row, col: before.col })

  // Ctrl+Z nel campo etichetta annulla il TESTO, non la board
  const label = page.locator('.props input').first()
  await label.click()
  await label.press('Control+z')
  await page.waitForTimeout(200)
  after = readBoards()[0].buttons[0]
  expect(after.colSpan).toBe(before.colSpan)

  // fuori dai campi le frecce tornano a muovere il bottone
  await page.locator('.edit-grid').click({ position: { x: 400, y: 300 } })
  await page.locator('.btn-wrapper').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => readBoards()[0].buttons[0].row).toBe(before.row + 1)

  await app.close()
})

test('annulla: non attraversa il cambio di board', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  await makeButton(page, readBoards)

  // Una seconda modifica sulla prima board, ed è il punto del test: pushUndo
  // salva lo stato PRIMA della modifica, quindi dopo il solo inserimento in
  // cima allo stack c'è una board VUOTA. Riversare quella su una board a sua
  // volta vuota non si distingue dal comportamento giusto, e il test passava
  // anche col difetto. Con questa mossa in più l'istantanea in cima contiene
  // un bottone, e se l'annulla attraversasse il cambio board lo si vedrebbe
  // comparire dove non è mai stato.
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => readBoards()[0].buttons[0].row).toBeGreaterThan(1)

  // Seconda board, vuota
  await page.getByRole('button', { name: /Nuova board/ }).click()
  await page.getByPlaceholder('Nome board').fill('Seconda')
  await page.getByRole('button', { name: 'Crea' }).click()
  await page.waitForTimeout(300)
  await page.locator('select.board-select').selectOption({ label: 'Seconda' })
  await page.waitForTimeout(300)

  const seconda = () => readBoards().find((b) => b.name === 'Seconda')
  const prima = () => readBoards().find((b) => b.name === 'Test')
  expect(seconda().buttons).toHaveLength(0)

  // Ctrl+Z qui non deve riversare i bottoni della prima board su questa
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(400)
  expect(seconda().buttons).toHaveLength(0)
  expect(prima().buttons).toHaveLength(1)

  await app.close()
})

test('annulla: scrivere un etichetta fa una voce sola, non una per lettera', async () => {
  const { app, page, readBoards } = await launchApp({ library: LIBRARY })
  await makeButton(page, readBoards)

  const label = page.locator('.props input').first()
  await label.fill('')
  await label.pressSequentially('Taverna', { delay: 30 })
  await expect.poll(() => readBoards()[0].buttons[0].label).toBe('Taverna')

  // Un solo annulla riporta l'etichetta di partenza: se ogni lettera fosse una
  // voce ne servirebbero sette e qui ne resterebbe "Tavern"
  await page.locator('.edit-grid').click({ position: { x: 400, y: 300 } })
  await page.locator('.btn-wrapper').first().click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => readBoards()[0].buttons[0].label).toBe('Marcia')

  await app.close()
})
