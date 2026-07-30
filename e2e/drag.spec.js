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

// Rosso finché la fase 7 non aggiunge il controllo di collisione: oggi un drop
// sopra un bottone esistente ne impila due sulle stesse celle. Marcato fail
// apposta, così diventerà un promemoria quando inizierà a passare invece di
// restare un test dimenticato.
test.fail('trascinamento: un drop su una cella occupata non deve sovrapporre', async () => {
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
