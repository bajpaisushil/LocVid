import path from 'node:path'
import { chromium, expect, test, type Page } from '@playwright/test'
import { decodeErrors, fixture, hasFfprobe, seekTo } from './helpers.ts'

/**
 * Opt-in: downloads the real Depth Anything V2 model (~27–50 MB) and the
 * subject cut-out models (IS-Net + MI-GAN, ~207 MB), and checks that cinematic
 * 3D motion moves the picture with parallax, that a cut-out subject moves on
 * its own over an unchanged background, and that both export. Run with
 * LOCVID_E2E_MODEL=1 (set LOCVID_E2E_PROFILE to reuse downloads between runs).
 */
test.skip(!process.env.LOCVID_E2E_MODEL, 'set LOCVID_E2E_MODEL=1 to run with the real depth model')
test.setTimeout(10 * 60 * 1000)

test('cinematic 3D motion: depth model, moving camera, exported video', async ({ baseURL }, info) => {
  const profile = process.env.LOCVID_E2E_PROFILE ?? path.resolve('test-results/model-profile')
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = context.pages()[0] ?? (await context.newPage())
  try {
    await page.goto(baseURL!)
    await page.getByTestId('new-project').click()
    await page.getByTestId('create-project').click()
    await page.getByTestId('media-input').setInputFiles([fixture('depth-scene.jpg')])
    await page.getByRole('button', { name: /Create scenes/ }).click({ timeout: 30_000 })
    await page.getByTestId('scene-block').first().click()
    await page.getByTestId('motion-type').getByText('Cinematic 3D').click()
    const gate = page.getByTestId('depth-download').or(page.getByTestId('depth-ready')).or(page.getByTestId('depth-analyzing'))
    await expect(gate).toBeVisible()
    if (await page.getByTestId('depth-download').isVisible()) await page.getByTestId('depth-download').click()
    await expect(page.getByTestId('depth-ready')).toBeVisible({ timeout: 5 * 60 * 1000 })
    await page.getByTestId('camera-move').click()
    await page.getByRole('option', { name: 'Orbit right (around subject)' }).click()

    // Two moments of the same shot must differ: the camera moved.
    const frame = async (seconds: number) => {
      await seekTo(page, seconds)
      await expect(page.getByTestId('time-readout')).toContainText(`0:0${seconds}.0`)
      await page.waitForTimeout(600)
      return page.getByTestId('preview-canvas').screenshot()
    }
    const a = await frame(1)
    const b = await frame(4)
    expect(Buffer.compare(a, b)).not.toBe(0)

    await page.getByTestId('open-export').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('start-export').click()
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('export-done')).not.toContainText('2D motion was used instead')
    const out = info.outputPath('cinematic.mp4')
    await (await download).saveAs(out)
    if (hasFfprobe) expect(decodeErrors(out)).toBe('')
  } finally {
    await context.close()
  }
})

/** Seek the preview by whole frames (Home, then → per frame) after leaving any control. */
async function seekFrames(page: Page, frames: number) {
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.waitForTimeout(250)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Home')
  for (let i = 0; i < frames; i++) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(700)
}

/** The preview as a 64×36 grid of luminance values. */
function previewLuma(page: Page): Promise<number[]> {
  return page.getByTestId('preview-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const small = document.createElement('canvas')
    small.width = 64
    small.height = 36
    const ctx = small.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(canvas, 0, 0, 64, 36)
    const d = ctx.getImageData(0, 0, 64, 36).data
    return Array.from({ length: 64 * 36 }, (_, i) => 0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!)
  })
}

test('subject animation: cut-out models, a jumping subject over a clean plate, a football, exported', async ({ baseURL }, info) => {
  const profile = process.env.LOCVID_E2E_PROFILE ?? path.resolve('test-results/model-profile')
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = context.pages()[0] ?? (await context.newPage())
  try {
    await page.goto(baseURL!)
    await page.getByTestId('new-project').click()
    await page.getByTestId('create-project').click()
    await page.getByTestId('media-input').setInputFiles([fixture('kid-football.jpg')])
    await page.getByRole('button', { name: /Create scenes/ }).click({ timeout: 30_000 })
    await page.getByTestId('scene-block').first().click()
    await page.getByTestId('motion-type').getByText('Cinematic 3D').click()
    const depthGate = page.getByTestId('depth-download').or(page.getByTestId('depth-ready')).or(page.getByTestId('depth-analyzing'))
    await expect(depthGate).toBeVisible()
    if (await page.getByTestId('depth-download').isVisible()) await page.getByTestId('depth-download').click()
    await expect(page.getByTestId('depth-ready')).toBeVisible({ timeout: 5 * 60 * 1000 })

    // The cut-out models are offered with their size and only downloaded on request.
    const gate = page.getByTestId('subject-download').or(page.getByTestId('subject-ready')).or(page.getByTestId('subject-analyzing'))
    await expect(gate).toBeVisible({ timeout: 60_000 })
    if (await page.getByTestId('subject-download').isVisible()) await page.getByTestId('subject-download').click()
    await expect(page.getByTestId('subject-ready')).toBeVisible({ timeout: 10 * 60 * 1000 })

    // The same moment, subject still vs. mid-jump: the background is identical, the subject has moved.
    await seekFrames(page, 20)
    const still = await previewLuma(page)
    await page.getByTestId('subject-action').click()
    await page.getByRole('option', { name: 'Jump' }).click()
    await seekFrames(page, 20)
    const jumping = await previewLuma(page)
    const diff = still.map((v, i) => Math.abs(v - jumping[i]!))
    const leftStrip = diff.filter((_, i) => i % 64 < 8)
    expect(leftStrip.reduce((a, b) => a + b, 0) / leftStrip.length).toBeLessThan(3)
    expect(diff.filter((d) => d > 25).length).toBeGreaterThan(40)

    // A kick with the football, exported through the worker.
    await page.getByTestId('subject-action').click()
    await page.getByRole('option', { name: 'Kick' }).click()
    await page.getByTestId('prop-football').click()
    await expect(page.getByTestId('prop-football')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('open-export').click()
    const download = page.waitForEvent('download')
    await page.getByTestId('start-export').click()
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('export-done')).not.toContainText('2D motion was used instead')
    await expect(page.getByTestId('export-done')).not.toContainText('not cut out')
    const out = info.outputPath('subject.mp4')
    await (await download).saveAs(out)
    if (hasFfprobe) expect(decodeErrors(out)).toBe('')
  } finally {
    await context.close()
  }
})
