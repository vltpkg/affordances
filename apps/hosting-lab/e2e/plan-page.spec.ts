import { expect, test } from '@playwright/test'
import { createClient } from '@affordances/mcp'

// M8e's T8 pages (results/surfaces-t8/PLAN.md §3), on the production build: the plans page shows no region, and each
// plan's own page, one link away, lists every region it's served from, in the browser and in v0's page graph alike

test("each plan's page, one link from the plans page, lists exactly its regions", async ({
  page,
}) => {
  await page.goto('/plans')
  await expect(page.getByText('EU West')).toHaveCount(0)
  await expect(page.getByText('US East')).toHaveCount(0)
  const pro = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) })
  await pro.getByRole('link', { name: 'Details' }).click()
  await expect(page).toHaveURL(/\/plans\/pro$/)
  await expect(page.getByRole('heading', { name: 'Pro', level: 1 })).toBeVisible()
  const servedFrom = page.getByRole('region', { name: 'Served from' }).getByRole('listitem')
  await expect(servedFrom).toHaveText(['US East (US)'])
  await page.goto('/plans/business')
  await expect(page.getByRole('region', { name: 'Served from' }).getByRole('listitem')).toHaveText([
    'US East (US)',
    'EU West (EU)',
  ])
  expect((await page.goto('/plans/enterprise'))!.status()).toBe(404)
})

test("v0's graph links each plan's page from the plans page, and the plan's page holds its regions", async ({
  baseURL,
}) => {
  const client = createClient(baseURL!)
  const plans = await client.open('/plans')
  expect(JSON.stringify(plans.entities)).not.toContain('eu-west')
  expect(plans.nav?.map((n) => n.to)).toEqual(['/plans/hobby', '/plans/pro', '/plans/business'])
  const business = await client.open('/plans/business')
  expect(
    (business.entities as { servedFrom: { slug: string }[] }).servedFrom.map((r) => r.slug),
  ).toEqual(['us-east', 'eu-west'])
  const pro = await client.open('/plans/pro')
  expect(
    (pro.entities as { servedFrom: { slug: string }[] }).servedFrom.map((r) => r.slug),
  ).toEqual(['us-east'])
})
