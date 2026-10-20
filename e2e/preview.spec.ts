import { expect, test } from '@playwright/test'
import { BLUE, MAGENTA, RED, createProject, createScenesFromImport, importMedia, isColor, sampleCanvas, seekTo, whitePixelRatio } from './helpers.ts'

test('preview shows the intended scene, video frames and text overlays at each time', async ({ page }) => {
  await createProject(page, 'Preview check')
  await importMedia(page, ['red-beach.png', 'blue-mountain.png', 'clip-magenta.mp4'], 3)
  await createScenesFromImport(page, 3)

  // A title on scene 1 (white text over red).
  await page.getByTestId('scene-block').first().click()
  await page.getByTestId('add-text').click()
  await page.getByTestId('add-text-title').click()
  await page.getByTestId('overlay-text').fill('BIG TITLE')

  // Scene 1 at t≈2 s: red, with white title pixels in the middle band.
  await seekTo(page, 2)
  await expect.poll(async () => isColor(await sampleCanvas(page, 0.5, 0.15), RED)).toBe(true)
  expect(await whitePixelRatio(page, 0.2, 0.35, 0.8, 0.55)).toBeGreaterThan(0.05)
  await expect(page.getByTestId('time-readout')).toContainText('0:02.0')

  // Scene 2 at t≈7 s: blue, and no title.
  await seekTo(page, 7)
  await expect.poll(async () => isColor(await sampleCanvas(page, 0.5, 0.5), BLUE)).toBe(true)
  expect(await whitePixelRatio(page, 0.2, 0.35, 0.8, 0.55)).toBeLessThan(0.01)

  // Scene 3 at t≈11 s: frames from the magenta video clip.
  await seekTo(page, 11)
  await expect.poll(async () => isColor(await sampleCanvas(page, 0.5, 0.5), MAGENTA), { timeout: 10_000 }).toBe(true)
})

test('play advances time and pause stops it', async ({ page }) => {
  await createProject(page, 'Playback')
  await importMedia(page, ['red-beach.png', 'blue-mountain.png'], 2)
  await createScenesFromImport(page, 2)
  await page.getByTestId('play-toggle').click()
  await page.waitForTimeout(1500)
  await page.getByTestId('play-toggle').click()
  const text = (await page.getByTestId('time-readout').textContent())!
  const seconds = Number(/0:(\d+\.\d)/.exec(text)?.[1])
  expect(seconds).toBeGreaterThan(0.8)
  expect(seconds).toBeLessThan(3)
  await page.waitForTimeout(500)
  await expect(page.getByTestId('time-readout')).toHaveText(text)
})
