import { expect, test } from '@playwright/test'
import { createProject, fixture, importMedia, sampleCanvas } from './helpers.ts'

/** A cheap fingerprint of what the preview shows right now. */
function previewSignature(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId('preview-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const small = document.createElement('canvas')
    small.width = 48
    small.height = 27
    const ctx = small.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(canvas, 0, 0, 48, 27)
    let h = 0
    for (const v of ctx.getImageData(0, 0, 48, 27).data) h = (h * 31 + v) >>> 0
    return h
  })
}

test('a prompt on the home screen becomes a live 3D video that plays right away', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('home-prompt').fill('create video of a village boy playing')
  await page.getByTestId('home-prompt-go').click()
  // No dialog to click through: the shots land on the timeline and start playing.
  await expect(page.getByTestId('scene-block')).toHaveCount(7)
  await expect(page.getByTestId('prompt-dialog')).toHaveCount(0)
  await expect(page.getByTestId('project-name')).toHaveText('A village boy playing')
  await expect(page.getByTestId('timeline-summary')).toContainText('0:30')
  await expect.poll(async () => (await page.getByTestId('time-readout').textContent()) ?? '', { timeout: 10_000 }).not.toMatch(/^0:00\.0/)
  // The picture really moves: the preview changes from moment to moment.
  const a = await previewSignature(page)
  await page.waitForTimeout(800)
  const b = await previewSignature(page)
  expect(a).not.toBe(b)
  // It's live 3D (visuals only, no text), with shot controls in the panel.
  await page.getByTestId('play-toggle').click()
  await page.getByTestId('scene-block').first().click()
  await expect(page.getByTestId('world-controls')).toBeVisible()
  await expect(page.getByTestId('overlay-item')).toHaveCount(0)
})

test('"Describe your video" defaults to live 3D without photos, and plays what it makes', async ({ page }) => {
  await createProject(page, 'Dance')
  await page.getByTestId('open-prompt').click()
  await page.getByTestId('prompt-input').fill('a girl dancing in the park at sunset')
  await expect(page.getByTestId('source-world')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('world-summary')).toContainText('Park · sunset')
  await expect(page.getByTestId('world-action').first()).toContainText('dancing')
  await page.getByText('15 s', { exact: true }).click()
  await page.getByTestId('prompt-create').click()
  await expect(page.getByTestId('prompt-dialog')).toBeHidden()
  await expect(page.getByTestId('scene-block')).toHaveCount(4)
  await expect.poll(async () => (await page.getByTestId('time-readout').textContent()) ?? '', { timeout: 10_000 }).not.toMatch(/^0:00\.0/)
})

test('a live 3D video exports as moving footage', async ({ page }, info) => {
  await page.goto('/')
  await page.getByTestId('home-prompt').fill('kids playing football in a village')
  await page.getByTestId('home-prompt-go').click()
  await expect(page.getByTestId('scene-block')).toHaveCount(7)
  await page.getByTestId('play-toggle').click()
  await page.getByTestId('open-export').click()
  await page.getByTestId('engine-webcodecs').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('start-export').click()
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 180_000 })
  await expect(page.getByTestId('export-done')).not.toContainText('2D')
  const out = info.outputPath('world.mp4')
  await (await download).saveAs(out)
  const { decodeErrors, ffprobe, frameColor, hasFfprobe } = await import('./helpers.ts')
  if (hasFfprobe) {
    expect(decodeErrors(out)).toBe('')
    expect(ffprobe(out).streams.some((s) => s.codec_name === 'h264')).toBe(true)
    // Different moments of the story look different (the camera and the characters move).
    const early = frameColor(out, 2, '200:200:540:260')
    const later = frameColor(out, 14, '200:200:540:260')
    expect(Math.max(...early.map((v, i) => Math.abs(v - later[i]!)))).toBeGreaterThan(4)
  }
})

test('one photo becomes several differently framed shots', async ({ page }) => {
  await createProject(page, 'Framing')
  await importMedia(page, ['red-beach.png'], 1)
  await page.getByTestId('open-prompt').click()
  await page.getByTestId('prompt-input').fill('a day at the beach')
  await expect(page.getByTestId('source-imported')).toHaveAttribute('aria-checked', 'true')
  await page.getByText('15 s').click()
  await page.getByTestId('prompt-create').click()
  await expect(page.getByTestId('scene-block')).toHaveCount(4)
  // Every shot uses the photo, but close-ups/medium shots are cropped differently from the wide ones.
  const sizes = await page.getByTestId('scene-block').evaluateAll((blocks) =>
    blocks.map((b) => (b.querySelector('[role="button"]') as HTMLElement).style.backgroundSize),
  )
  expect(new Set(sizes).size).toBeGreaterThanOrEqual(2)
})

test('film looks render through WebGL in both the preview and the export', async ({ page }, info) => {
  await createProject(page, 'Noir')
  await page.getByTestId('media-input').setInputFiles([fixture('red-beach.png')])
  await page.getByRole('button', { name: /Create scenes/ }).click({ timeout: 30_000 })
  await page.getByTestId('scene-block').first().click()
  await page.getByTestId('look-grade').click()
  await page.getByRole('option', { name: 'Noir (black & white)' }).click()
  // Red picture under a black & white grade → gray in the preview.
  await expect
    .poll(async () => {
      const [r, g, b] = await sampleCanvas(page, 0.5, 0.5)
      return Math.max(Math.abs(r - g), Math.abs(g - b))
    })
    .toBeLessThan(12)
  await page.getByTestId('open-export').click()
  await page.getByTestId('engine-webcodecs').click()
  const download = page.waitForEvent('download')
  await page.getByTestId('start-export').click()
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 })
  const out = info.outputPath('noir.mp4')
  await (await download).saveAs(out)
  const { frameColor, hasFfprobe } = await import('./helpers.ts')
  if (hasFfprobe) {
    const [r, g, b] = frameColor(out, 2)
    expect(Math.max(Math.abs(r - g), Math.abs(g - b))).toBeLessThan(14)
  }
})

test('a football prompt plans what the subject does in every shot — with consent before any model download', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) external.push(r.url())
  })
  await createProject(page, 'Football')
  await importMedia(page, ['kid-football.jpg'], 1)
  await page.getByTestId('open-prompt').click()
  await page.getByTestId('prompt-input').fill('create a video showing chhota bheem playing football in a village')
  await expect(page.getByTestId('source-imported')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('prompt-life')).toHaveAttribute('aria-checked', 'true')
  // The models are offered (with their size), never fetched on their own.
  await expect(page.getByTestId('prompt-cutout-download')).toBeVisible()
  const actions = page.getByTestId('shot-action')
  await expect(actions.filter({ hasText: 'runs' }).first()).toBeVisible()
  await expect(actions.filter({ hasText: 'kicks' })).toHaveCount(1)
  await expect(page.getByLabel('Props: football').first()).toBeVisible()
  // Visuals-first defaults; switching subject animation off removes the actions.
  await page.getByTestId('prompt-life').click()
  await expect(actions).toHaveCount(0)
  expect(external.filter((u) => u.includes('huggingface'))).toEqual([])
})
