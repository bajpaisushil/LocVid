import { expect, test } from '@playwright/test'
import { createProject, createScenesFromImport, importMedia } from './helpers.ts'

const sceneIds = (page: import('@playwright/test').Page) =>
  page.getByTestId('scene-block').evaluateAll((els) => els.map((e) => e.getAttribute('data-scene-id')!))

test('create, edit, reorder and delete scenes with correct durations', async ({ page }) => {
  await createProject(page, 'Scene editing')
  await importMedia(page, ['red-beach.png', 'blue-mountain.png', 'clip-magenta.mp4'], 3)
  await createScenesFromImport(page, 3)

  // Images default to 5 s, the 3 s clip to its length → 13 s.
  await expect(page.getByTestId('timeline-summary')).toHaveText('3 scenes · 0:13.0')
  await expect(page.getByTestId('project-duration')).toContainText('0:13.0')

  // Add a blank scene and a title card from the timeline menu.
  await page.getByTestId('add-scene').click()
  await page.getByTestId('add-blank-scene').click()
  await expect(page.getByTestId('scene-block')).toHaveCount(4)
  await expect(page.getByTestId('timeline-summary')).toHaveText('4 scenes · 0:18.0')

  // Edit a duration.
  await page.getByTestId('scene-block').nth(3).click()
  const duration = page.getByTestId('scene-duration-input')
  await duration.fill('2.25')
  await duration.press('Enter')
  await expect(page.getByTestId('scene-block').nth(3).getByTestId('scene-duration')).toHaveText('2.3s')
  await expect(page.getByTestId('timeline-summary')).toHaveText('4 scenes · 0:15.2')

  // Reorder with the keyboard: pick up scene 1, move right twice, drop.
  const before = await sceneIds(page)
  const first = page.getByTestId('scene-block').first().getByRole('button', { name: /^Scene 1:/ })
  await first.focus()
  // Paced like a person: dnd-kit measures positions between key presses.
  for (const key of ['Enter', 'ArrowRight', 'ArrowRight', 'Enter']) {
    await page.keyboard.press(key)
    await page.waitForTimeout(250)
  }
  await expect.poll(() => sceneIds(page)).toEqual([before[1], before[2], before[0], before[3]])

  // Delete via the scene menu, then undo/redo.
  await page.getByTestId('scene-block').nth(1).hover()
  await page.getByRole('button', { name: 'Scene 2 actions' }).click()
  await page.getByTestId('delete-scene').click()
  await expect(page.getByTestId('scene-block')).toHaveCount(3)
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('scene-block')).toHaveCount(4)
  await page.getByTestId('redo').click()
  await expect(page.getByTestId('scene-block')).toHaveCount(3)

  // Keyboard undo works too.
  await page.locator('body').click({ position: { x: 700, y: 400 } })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(page.getByTestId('scene-block')).toHaveCount(4)
})

test('text overlays can be added, edited, styled and removed', async ({ page }) => {
  await createProject(page, 'Text overlays')
  await importMedia(page, ['blue-mountain.png'], 1)
  await createScenesFromImport(page, 1)
  await page.getByTestId('scene-block').first().click()
  await page.getByTestId('add-text').click()
  await page.getByTestId('add-text-lowerThird').click()
  await expect(page.getByTestId('overlay-editor')).toBeVisible()
  await page.getByTestId('overlay-text').fill('Jane Doe · Host')
  await expect(page.getByTestId('overlay-item')).toContainText('Jane Doe · Host')
  await expect(page.getByTestId('overlay-outline')).toBeVisible()
  await page.getByTestId('delete-overlay').click()
  await expect(page.getByTestId('overlay-item')).toHaveCount(0)
})

test('script to storyboard builds editable scenes, matched to images by file name', async ({ page }) => {
  await createProject(page, 'Storyboard')
  await importMedia(page, ['red-beach.png', 'blue-mountain.png'], 2)
  await page.getByTestId('open-storyboard').click()
  await page
    .getByTestId('storyboard-text')
    .fill('# The coast\nWaves roll onto the beach.\n\n# The hills\nWe climb the mountain trail.\n\n# Home\nBack in the city at night.')
  const rows = page.getByTestId('storyboard-scenes').locator('li')
  await expect(rows).toHaveCount(3)
  await expect(page.getByTestId('storyboard-dialog')).toContainText('Rule-based · no AI')
  await expect(rows.nth(0)).toContainText('File name matches “beach”')
  await expect(rows.nth(1)).toContainText('File name matches “mountain”')
  // Edit a caption before creating.
  await rows.nth(2).getByRole('textbox', { name: 'Caption for scene 3' }).fill('Home, sweet home.')
  await page.getByTestId('storyboard-create').click()
  await expect(page.getByTestId('scene-block')).toHaveCount(3)
  await page.getByTestId('scene-block').nth(2).click()
  await expect(page.getByTestId('scene-title')).toHaveValue('Home')
  await page.getByTestId('overlay-item').first().click()
  await expect(page.getByTestId('overlay-text')).toHaveValue('Home, sweet home.')
})
