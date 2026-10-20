import { expect, test } from '@playwright/test'

test('app starts on the home screen without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.goto('/')
  await expect(page.getByTestId('empty-projects')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New project' }).first()).toBeVisible()
  await expect(page.getByText('Your media stays on this device')).toBeVisible()
  expect(errors).toEqual([])
})
