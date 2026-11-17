import { expect, test } from '@playwright/test'

// the UI path, as a person uses it: every action runs, and its consequence shows. Each test is a fresh browser
// context, so a fresh session and account

test('moving to Pro charges the first month and changes the plan', async ({ page }) => {
  await page.goto('/plans')
  await page.getByRole('button', { name: 'Move to Pro', exact: true }).click()
  await page.goto('/')
  await expect(page.getByText('$20 a month').or(page.locator('dd', { hasText: '$20' }))).toBeVisible()
  await expect(page.locator('dl')).toContainText('Pro')
  await expect(page.getByRole('list').filter({ hasText: 'Pro, first month' })).toContainText('$20')
})

test('the bundle, then cancelling: it renews as Hobby, with nothing refunded', async ({ page }) => {
  await page.goto('/plans')
  await page.getByRole('button', { name: 'Move to Pro Plus' }).click()
  await page.goto('/')
  await expect(page.locator('dl')).toContainText('pro-plus')
  await expect(page.locator('dl')).toContainText('$35')
  await page.getByRole('button', { name: /Cancel/ }).click()
  await expect(page.locator('dl')).toContainText('Renews asHobby')
  await expect(page.getByRole('list').filter({ hasText: 'Pro Plus, first month' })).toContainText('$35')
})

test('an add-on is added and charged, then removed at the end of the month', async ({ page }) => {
  await page.goto('/add-ons')
  const backups = page.getByRole('listitem').filter({ hasText: 'Daily backups' })
  await backups.getByRole('button', { name: 'Add' }).click()
  await expect(backups.getByRole('button', { name: 'Remove' })).toBeVisible()
  await backups.getByRole('button', { name: 'Remove' }).click()
  await expect(backups).toContainText('stops at the end of the month')
  await page.goto('/')
  await expect(page.getByRole('list').filter({ hasText: 'Daily backups, first month' })).toContainText('$5')
})

test('deploying publishes; on Pro an earlier deployment can be rolled back to', async ({ page }) => {
  await page.goto('/plans')
  await page.getByRole('button', { name: 'Move to Pro', exact: true }).click()
  await page.goto('/deployments')
  for (const ref of ['v1', 'v2']) {
    await page.getByLabel('Git ref').fill(ref)
    await page.getByRole('button', { name: 'Deploy' }).click()
    await expect(page.getByText(`· ${ref} · ready`)).toBeVisible()
  }
  await expect(page.getByText('v2 · ready · published')).toBeVisible()
  await page.getByRole('button', { name: 'Roll back to this' }).click()
  await expect(page.getByText('v1 · ready · published')).toBeVisible()
  await expect(page.getByText('50 of 3000 build minutes')).toBeVisible()
})
