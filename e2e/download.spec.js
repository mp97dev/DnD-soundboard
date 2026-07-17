const { test, expect } = require('@playwright/test')
const { launchApp, createBoard } = require('./helpers')

const YT_PLACEHOLDER = 'URL o playlist YouTube'

test('download YouTube: progresso visibile e traccia in libreria', async () => {
  const { app, page } = await launchApp()
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()

  await page.getByPlaceholder(YT_PLACEHOLDER).fill('https://youtu.be/dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Scarica audio da YouTube' }).click()

  // Durante il download: un job con fase e percentuale
  await expect(page.locator('.job')).toBeVisible()
  await expect(page.locator('.job-pct')).toHaveText(/\d+%/)

  // A fine download: traccia in libreria, job sparito, nessun errore
  await expect(page.locator('.track .title')).toHaveText('Test Track', { timeout: 20_000 })
  await expect(page.locator('.job')).toHaveCount(0)
  await expect(page.locator('.error')).toHaveCount(0)

  // Regressione CORS: l'audio engine carica i file via fetch(media://),
  // cross-origin rispetto all'origin del renderer
  const status = await page.evaluate(async () => {
    const res = await fetch('media://library/downloaded/dQw4w9WgXcQ.mp3')
    return res.status
  })
  expect(status).toBe(200)

  await app.close()
})

test('download in blocco: più URL scaricati insieme', async () => {
  const { app, page } = await launchApp()
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()

  await page
    .getByPlaceholder(YT_PLACEHOLDER)
    .fill('https://youtu.be/aaaaaaaaaaa\nhttps://youtu.be/bbbbbbbbbbb')
  await page.getByRole('button', { name: 'Scarica audio da YouTube' }).click()

  // Due download accodati contemporaneamente
  await expect(page.locator('.job')).toHaveCount(2)

  // Entrambe le tracce finiscono in libreria
  await expect(page.locator('.track .title')).toHaveCount(2, { timeout: 20_000 })
  await expect(page.locator('.job')).toHaveCount(0)
  await expect(page.locator('.error')).toHaveCount(0)

  await app.close()
})

test('download playlist: gli URL vengono espansi', async () => {
  const { app, page } = await launchApp()
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()

  await page
    .getByPlaceholder(YT_PLACEHOLDER)
    .fill('https://www.youtube.com/playlist?list=PLfake')
  await page.getByRole('button', { name: 'Scarica audio da YouTube' }).click()

  // Le playlist chiedono conferma prima di accodare i download
  await expect(page.locator('.bulk-confirm')).toContainText('2')
  await page.getByRole('button', { name: 'Scarica tutti' }).click()

  // La playlist finta espande a due video
  await expect(page.locator('.track .title')).toHaveCount(2, { timeout: 20_000 })
  await expect(page.locator('.error')).toHaveCount(0)

  await app.close()
})

test('download playlist: annulla non accoda nulla', async () => {
  const { app, page } = await launchApp()
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()

  await page
    .getByPlaceholder(YT_PLACEHOLDER)
    .fill('https://www.youtube.com/playlist?list=PLfake')
  await page.getByRole('button', { name: 'Scarica audio da YouTube' }).click()

  await expect(page.locator('.bulk-confirm')).toBeVisible()
  await page.getByRole('button', { name: 'Annulla', exact: true }).click()

  await expect(page.locator('.bulk-confirm')).toHaveCount(0)
  await expect(page.locator('.job')).toHaveCount(0)
  await expect(page.locator('.track .title')).toHaveCount(0)

  await app.close()
})

test('builtin mancante: il bottone "file mancanti" la ri-scarica', async () => {
  const { app, page } = await launchApp({
    builtinTracks: [
      {
        id: 'yt_dQw4w9WgXcQ',
        version: 1,
        title: 'Builtin Track',
        type: 'music',
        volume: 0.7,
        audioPath: 'library/downloaded/dQw4w9WgXcQ.mp3',
        thumbnailPath: null,
        source: { type: 'youtube', youtubeId: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ' }
      }
    ]
  })

  // La sidebar libreria è visibile solo in Edit mode
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()

  // La traccia builtin appare in libreria, segnata come mancante
  const track = page.locator('.track', { hasText: 'Builtin Track' })
  await expect(track).toHaveClass(/missing/)

  const updateBtn = page.getByRole('button', { name: /file mancanti/ })
  await updateBtn.click()
  await expect(page.locator('.job')).toBeVisible()

  // A fine ri-download: non più mancante, bottone sparito, nessun errore
  await expect(track).not.toHaveClass(/missing/, { timeout: 20_000 })
  await expect(page.getByRole('button', { name: /file mancanti/ })).toHaveCount(0)
  await expect(page.locator('.error')).toHaveCount(0)

  await app.close()
})

test('media://: il protocollo supporta le richieste Range (streaming)', async () => {
  const { app, page } = await launchApp()
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()

  await page.getByPlaceholder(YT_PLACEHOLDER).fill('https://youtu.be/dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Scarica audio da YouTube' }).click()
  await expect(page.locator('.track .title')).toHaveText('Test Track', { timeout: 20_000 })

  // Il media player di Chromium streama a byte range: senza 206 l'audio stuttera
  const res = await page.evaluate(async () => {
    const r = await fetch('media://library/downloaded/dQw4w9WgXcQ.mp3', {
      headers: { Range: 'bytes=0-1' }
    })
    return { status: r.status, acceptRanges: r.headers.get('accept-ranges') }
  })
  expect(res.status).toBe(206)
  expect(res.acceptRanges).toBe('bytes')

  await app.close()
})

test('download YouTube: URL non valido mostra errore', async () => {
  const { app, page } = await launchApp()
  await createBoard(page, 'Test')
  await page.getByRole('button', { name: /Edit/ }).click()

  await page.getByPlaceholder(YT_PLACEHOLDER).fill('https://example.com/not-youtube')
  await page.getByRole('button', { name: 'Scarica audio da YouTube' }).click()

  await expect(page.locator('.job-error')).toContainText('URL YouTube non valido')
  await expect(page.locator('.track')).toHaveCount(0)

  await app.close()
})
