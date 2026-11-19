import { expect, test } from 'vitest'
import { regions } from '../src/catalog.ts'
import { planPage } from '../src/app/plans/[slug]/plan.ts'
import plansState from '../src/app/plans/state.ts'

// M8e's T8 pages (results/surfaces-t8/PLAN.md §3): each plan's page lists every region it's served from, as a complete
// list, and the plans page shows no region, so the pages' one step is the graph's one expansion

test("each plan's page lists exactly the regions that serve it, from the catalog", () => {
  expect(planPage('hobby')!.servedFrom.map((r) => r.slug)).toEqual(['us-east'])
  expect(planPage('pro')!.servedFrom.map((r) => r.slug)).toEqual(['us-east'])
  expect(planPage('business')!.servedFrom.map((r) => r.slug)).toEqual(['us-east', 'eu-west'])
  for (const slug of ['hobby', 'pro', 'business'])
    expect(planPage(slug)!.servedFrom.map((r) => r.slug)).toEqual(
      regions.filter((r) => r.plans.includes(slug as never)).map((r) => r.slug),
    )
  expect(planPage('enterprise')).toBeNull()
})

test("the plans page's graph has no region in it, and links each plan's page", async () => {
  const state = await plansState.load({
    params: {},
    searchParams: new URLSearchParams(),
    ctx: { session: null } as never,
  })
  const text = JSON.stringify(state)
  for (const r of regions) {
    expect(text).not.toContain(r.slug)
    expect(text).not.toContain(r.name)
  }
  expect(plansState.nav!(state as never).map((n) => n.to)).toEqual([
    '/plans/hobby',
    '/plans/pro',
    '/plans/business',
  ])
})
