import { expect, test } from '@playwright/test'
import { createProject, fixture } from './helpers.ts'

test('imports multiple images, video and audio; rejects invalid files with clear reasons', async ({ page }) => {
  await createProject(page, 'Media import')
  await page
    .getByTestId('media-input')
    .setInputFiles(['red-beach.png', 'blue-mountain.png', 'green-portrait.jpg', 'clip-magenta.mp4', 'music.mp3', 'notes.txt', 'broken.png'].map(fixture))

  await expect(page.getByTestId('asset-tile')).toHaveCount(5, { timeout: 30_000 })
  await expect(page.locator('[data-testid=asset-tile][data-asset-kind=image]')).toHaveCount(3)
  await expect(page.locator('[data-testid=asset-tile][data-asset-kind=video]')).toHaveCount(1)
  await expect(page.locator('[data-testid=asset-tile][data-asset-kind=audio]')).toHaveCount(1)

  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Imported 5 files' })
  await expect(toast).toContainText('2 skipped')
  await expect(toast).toContainText('notes.txt: Not a supported image, video or audio file.')
  await expect(toast).toContainText('broken.png: This image could not be decoded')

  // Metadata: durations shown on video/audio tiles; dimensions in the asset menu.
  await expect(page.locator('[data-testid=asset-tile][data-asset-kind=video]')).toContainText('3s')
  await expect(page.locator('[data-testid=asset-tile][data-asset-kind=audio]')).toContainText('12s')
  await page.getByRole('button', { name: 'Actions for red-beach.png' }).click()
  await expect(page.getByRole('menu')).toContainText('1600×900')
  await page.keyboard.press('Escape')
})

test('oversized photos are stored downscaled and duplicates are not stored twice', async ({ page }) => {
  await createProject(page, 'Big photos')
  await page.getByTestId('media-input').setInputFiles([fixture('huge-yellow.jpg')])
  await expect(page.getByTestId('asset-tile')).toHaveCount(1, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Actions for huge-yellow.jpg' }).click()
  await expect(page.getByRole('menu')).toContainText('4096×2731')
  await page.keyboard.press('Escape')

  // Importing the same file again reuses the stored copy.
  await page.getByTestId('media-input').setInputFiles([fixture('huge-yellow.jpg')])
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'already stored' })).toBeVisible()
  await expect(page.getByTestId('asset-tile')).toHaveCount(1)
})

test('removing media that scenes use asks for confirmation and falls back to a gradient', async ({ page }) => {
  await createProject(page, 'Remove media')
  await page.getByTestId('media-input').setInputFiles([fixture('red-beach.png')])
  await page.getByRole('button', { name: /Create scenes/ }).click({ timeout: 30_000 })
  await expect(page.getByTestId('scene-block')).toHaveCount(1)
  await page.getByRole('button', { name: 'Actions for red-beach.png' }).click()
  await page.getByRole('menuitem', { name: 'Remove from project' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('It is used in 1 scene')
  await page.getByTestId('confirm-action').click()
  await expect(page.getByTestId('asset-tile')).toHaveCount(0)
  await page.getByTestId('scene-block').first().click()
  await expect(page.getByTestId('scene-properties')).toContainText('Generated background')
  // Undo brings it back.
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('asset-tile')).toHaveCount(1)
})
