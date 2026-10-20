import { expect, test } from '@playwright/test'
import { createProject, createScenesFromImport, importMedia } from './helpers.ts'

test('no user media or project data is sent to any remote service', async ({ page, baseURL }) => {
  const requests: { url: string; method: string; hasBody: boolean }[] = []
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), hasBody: !!r.postDataBuffer() }))
  page.context().on('request', (r) => requests.push({ url: r.url(), method: r.method(), hasBody: !!r.postDataBuffer() }))

  await createProject(page, 'Privacy check')
  await importMedia(page, ['red-beach.png', 'clip-magenta.mp4', 'music.mp3'], 3)
  await createScenesFromImport(page, 2)
  await page.getByTestId('play-toggle').click()
  await page.waitForTimeout(1000)
  await page.getByTestId('play-toggle').click()

  for (const engine of ['webcodecs', 'ffmpeg'] as const) {
    await page.getByTestId('open-export').click()
    await page.getByTestId(`engine-${engine}`).click()
    const download = page.waitForEvent('download', { timeout: 300_000 })
    await page.getByTestId('start-export').click()
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 300_000 })
    await download
    await page.keyboard.press('Escape')
  }

  const origin = new URL(baseURL!).origin
  const external = requests.filter((r) => /^https?:/.test(r.url) && new URL(r.url).origin !== origin)
  expect(external, `unexpected external requests: ${external.map((r) => r.url).join(', ')}`).toEqual([])
  const uploads = requests.filter((r) => /^https?:/.test(r.url) && (r.method !== 'GET' || r.hasBody))
  expect(uploads).toEqual([])
  // Sanity: the app did fetch its own assets (FFmpeg core) from its own origin.
  expect(requests.some((r) => r.url.startsWith(origin) && r.url.includes('ffmpeg-core'))).toBe(true)
})

test('the production build enforces a Content-Security-Policy limiting network access', async ({ page }) => {
  await page.goto('/')
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toMatch(/connect-src 'self' blob: data: https:\/\/huggingface\.co/)
  expect(csp).not.toContain('*;')
})
