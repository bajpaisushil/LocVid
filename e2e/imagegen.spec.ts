import path from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import { createProject } from './helpers.ts'

/**
 * Opt-in: downloads the real ~2.5 GB SD-Turbo model from Hugging Face and
 * generates an image on WebGPU. Run with:
 *   LOCVID_E2E_MODEL=1 npx playwright test e2e/imagegen.spec.ts
 * A persistent browser profile (LOCVID_E2E_PROFILE, default test-results/model-profile)
 * keeps the model cached between runs.
 */
test.skip(!process.env.LOCVID_E2E_MODEL, 'set LOCVID_E2E_MODEL=1 to run the real model download + generation')
test.setTimeout(60 * 60 * 1000)

test('downloads SD-Turbo on request and generates an image locally on WebGPU', async ({ baseURL }) => {
  const profile = process.env.LOCVID_E2E_PROFILE ?? path.resolve('test-results/model-profile')
  const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 900 } })
  const page = context.pages()[0] ?? (await context.newPage())
  const external = new Set<string>()
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (/^https?:/.test(url.protocol) && url.origin !== new URL(baseURL!).origin) external.add(url.host)
  })
  try {
    await page.goto(baseURL!)
    await createProject(page, `Image generation ${Date.now()}`)
    await page.getByTestId('open-ai').click()
    await page.getByTestId('ai-tab-images').click()
    const panel = page.getByTestId('imagegen-panel')
    const download = panel.getByTestId('imagegen-download')
    const prompt = panel.getByTestId('imagegen-prompt')
    await expect(download.or(prompt).or(panel.getByTestId('imagegen-unsupported'))).toBeVisible()
    test.skip(await panel.getByTestId('imagegen-unsupported').isVisible(), 'WebGPU image generation is not supported on this machine')

    if (await download.isVisible()) {
      await panel.getByTestId('imagegen-accept').check()
      await download.click()
      await expect(panel.getByTestId('imagegen-downloading')).toBeVisible()
      await expect(prompt).toBeVisible({ timeout: 55 * 60 * 1000 })
    }

    await prompt.fill('a lighthouse on a rocky coast at sunset, photograph')
    await panel.getByTestId('imagegen-generate').click()
    const result = panel.getByTestId('imagegen-results').locator('img').first()
    await expect(result).toBeVisible({ timeout: 10 * 60 * 1000 })

    // The output is a real 512×512 image with actual content (not a flat color).
    const stats = await result.evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let sum = 0
      let sumSq = 0
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!
        sum += l
        sumSq += l * l
      }
      const n = d.length / 4
      return { width: c.width, height: c.height, mean: sum / n, std: Math.sqrt(sumSq / n - (sum / n) ** 2), src: c.toDataURL('image/png') }
    })
    expect(stats.width).toBe(512)
    expect(stats.height).toBe(512)
    expect(stats.std).toBeGreaterThan(12)
    await test.info().attach('generated.png', { body: Buffer.from(stats.src.split(',')[1]!, 'base64'), contentType: 'image/png' })

    // Adding it to the project stores it as generated media.
    await panel.getByRole('button', { name: 'Scene' }).first().click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('scene-block')).toHaveCount(1)
    // The only hosts contacted were Hugging Face's (model files).
    for (const host of external) expect(host).toMatch(/(^|\.)huggingface\.co$|(^|\.)hf\.co$/)
  } finally {
    await context.close()
  }
})
