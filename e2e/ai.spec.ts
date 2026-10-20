import { expect, test } from '@playwright/test'
import { createProject, createScenesFromImport, importMedia } from './helpers.ts'

test('the editor works without optional AI, and no model is fetched unless asked', async ({ page }) => {
  const modelRequests: string[] = []
  page.on('request', (r) => {
    if (/huggingface|hf\.co|onnx|ort-wasm/.test(r.url())) modelRequests.push(r.url())
  })
  await createProject(page, 'No AI needed')
  await importMedia(page, ['red-beach.png'], 1)
  await createScenesFromImport(page, 1)

  await page.getByTestId('open-ai').click()
  await expect(page.getByTestId('ai-dialog')).toBeVisible()

  // Level 1 generated scene: no model involved.
  await page.getByTestId('template-stat').click()
  await page.locator('#tpl-number').fill('73%')
  await page.locator('#tpl-label').fill('of people prefer local apps')
  await page.getByTestId('insert-template').click()
  await expect(page.getByTestId('scene-block')).toHaveCount(2)

  // Batch motion on photo scenes.
  await page.getByTestId('open-ai').click()
  await page.getByTestId('ai-tab-motion').click()
  await page.getByTestId('apply-motion-all').click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Applied motion to 1 scene' })).toBeVisible()

  // Image generation is gated behind an explicit license acknowledgement and download.
  await page.getByTestId('ai-tab-images').click()
  const panel = page.getByTestId('imagegen-panel')
  await expect(panel).toContainText('Stability AI Community License')
  const download = panel.getByTestId('imagegen-download')
  // The panel first checks the device; wait for its verdict.
  await expect(download.or(panel.getByTestId('imagegen-unsupported')).or(panel.getByTestId('imagegen-prompt'))).toBeVisible()
  if (await download.isVisible()) {
    await expect(download).toBeDisabled()
    await panel.getByTestId('imagegen-accept').check()
    await expect(download).toBeEnabled()
  } else {
    // Devices without WebGPU (or where it is already downloaded) show a clear status instead.
    await expect(panel.getByTestId('imagegen-unsupported').or(panel.getByTestId('imagegen-prompt'))).toBeVisible()
  }

  await page.getByTestId('ai-tab-device').click()
  await expect(page.getByTestId('device-report')).toContainText('WebGPU')
  expect(modelRequests).toEqual([])
})
