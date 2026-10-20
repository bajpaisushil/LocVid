import { expect, test } from '@playwright/test'
import { createProject, createScenesFromImport, importMedia, waitForSaved } from './helpers.ts'

test('create, list, rename, reopen and delete projects', async ({ page }) => {
  await createProject(page, 'Holiday reel', 'Vertical 9:16')
  await waitForSaved(page)
  await page.getByRole('button', { name: 'Back to projects' }).click()

  const card = page.getByTestId('project-card').filter({ hasText: 'Holiday reel' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('9:16')
  await expect(card).toContainText('Edited just now')

  // Rename through the card menu.
  await card.getByRole('button', { name: /Actions for Holiday reel/ }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.locator('#prompt-input').fill('Summer reel')
  await page.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByTestId('project-card-title')).toHaveText('Summer reel')

  // Reopen.
  await page.getByRole('button', { name: 'Open Summer reel' }).click()
  await expect(page.getByTestId('project-name')).toHaveText('Summer reel')
  await page.getByRole('button', { name: 'Back to projects' }).click()

  // Delete asks for confirmation; cancelling keeps the project.
  await page.getByRole('button', { name: /Actions for Summer reel/ }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('cannot be undone')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('project-card')).toHaveCount(1)

  await page.getByRole('button', { name: /Actions for Summer reel/ }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByTestId('confirm-action').click()
  await expect(page.getByTestId('empty-projects')).toBeVisible()
})

test('project data persists across a page reload', async ({ page }) => {
  await createProject(page, 'Persistence check')
  await importMedia(page, ['red-beach.png', 'blue-mountain.png', 'clip-magenta.mp4'], 3)
  await createScenesFromImport(page, 3)

  // Edit settings that must survive: duration, title, text overlay, transition, order.
  await page.getByTestId('scene-block').nth(1).click()
  const duration = page.getByTestId('scene-duration-input')
  await duration.fill('3.5')
  await duration.press('Enter')
  await page.getByTestId('scene-title').fill('The blue one')
  await page.getByTestId('add-text').click()
  await page.getByTestId('add-text-caption').click()
  await page.getByTestId('overlay-text').fill('Persisted caption')
  await page.getByTestId('scene-block').first().click()
  await page.getByRole('button', { name: /Scene 1 actions/ }).click({ force: true })
  await page.getByRole('menuitem', { name: 'Move right' }).click()
  await waitForSaved(page)

  const order = await page.getByTestId('scene-block').evaluateAll((els) => els.map((e) => e.getAttribute('data-scene-id')))
  const summary = await page.getByTestId('timeline-summary').innerText()
  expect(summary).toContain('3 scenes')
  expect(summary).toContain('0:11.5') // 5 + 3.5 + 3

  await page.reload()
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('scene-block')).toHaveCount(3)
  const reloaded = await page.getByTestId('scene-block').evaluateAll((els) => els.map((e) => e.getAttribute('data-scene-id')))
  expect(reloaded).toEqual(order)
  await expect(page.getByTestId('timeline-summary')).toContainText('0:11.5')

  // The edited scene is now first (it was moved left when scene 1 moved right).
  await page.getByTestId('scene-block').first().click()
  await expect(page.getByTestId('scene-title')).toHaveValue('The blue one')
  await expect(page.getByTestId('scene-duration-input')).toHaveValue('3.5')
  await page.getByTestId('overlay-item').first().click()
  await expect(page.getByTestId('overlay-text')).toHaveValue('Persisted caption')
  await expect(page.getByTestId('asset-tile')).toHaveCount(3)
})
