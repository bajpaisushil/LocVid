import { expect, test } from '@playwright/test'
import { createProject, fixture, importMedia, sampleCanvas } from './helpers.ts'

test('describe a video on the home screen → shots on the timeline, visuals only by default', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('home-prompt').fill('create a video showing a boy playing football in a village')
  await page.getByTestId('home-prompt-go').click()
  await expect(page.getByTestId('prompt-dialog')).toBeVisible()
  await expect(page.getByTestId('prompt-input')).toHaveValue('create a video showing a boy playing football in a village')
  await expect(page.getByTestId('project-name')).toHaveText('A boy playing football in a village')
  // No pictures yet → designed backgrounds; captions are off by default.
  await expect(page.getByTestId('source-designed')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('prompt-captions')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('prompt-shots').locator('li')).toHaveCount(7)
  await page.getByTestId('prompt-create').click()
  await expect(page.getByTestId('prompt-dialog')).toBeHidden()
  await expect(page.getByTestId('scene-block')).toHaveCount(7)
  await expect(page.getByTestId('timeline-summary')).toContainText('0:30')
  // Visual-first: no text overlays were added.
  await page.getByTestId('scene-block').first().click()
  await expect(page.getByTestId('overlay-item')).toHaveCount(0)
  // The preview lands inside the first shot, not on the black start of the fade-in.
  await expect.poll(async () => (await sampleCanvas(page, 0.5, 0.5, 0.3)).reduce((a, b) => a + b, 0)).toBeGreaterThan(60)
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
