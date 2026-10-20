import path from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import { decodeErrors, fixture, hasFfprobe, seekTo } from './helpers.ts'

/**
 * Opt-in: downloads the real Depth Anything V2 model (~27–50 MB) and checks
 * that cinematic 3D motion moves the picture with parallax in the preview and
 * in the exported MP4. Run with LOCVID_E2E_MODEL=1 (profile reused between runs).
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
