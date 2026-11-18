import * as lab from '@affordances/hosting-lab/trial'
import { expect, test } from 'vitest'
import { conditions } from '../src/conditions.ts'
import { createTools } from '../src/tools.ts'
import { setupTrial } from '../src/trial.ts'

// the confirmatory audit's case, on the amended runtime (RFC 0002 §6.6, M7a): under C's advocated policy at
// neighborhood depth 1, T6's first view left hosting.plan.list out, the only offer that returned the plans'
// bandwidthGb. The plan choice set's comparison now states it, for every member, in the view the agent's tool returns

type Comparison = {
  differ: string[]
  rows: Record<string, unknown>[]
  shared: Record<string, unknown>
  omitted: { attributes: string[] }
}
type View = {
  offers: { id: string; target?: { type: string; key: string } }[]
  choiceSets: { over: string; members: string[]; comparison: Comparison }[]
}

test('under advocated at depth 1, T6’s first view states Pro’s bandwidthGb', async () => {
  const condition = conditions.C
  expect([condition.policy.id, condition.policy.scope, condition.policy.depth ?? 1]).toEqual([
    'advocated',
    'neighborhood',
    1,
  ])
  const task = lab.tasks.find((t) => t.id === 'T6')!
  const trial = await setupTrial(condition, 0, 'T6')
  const view = JSON.parse((await createTools(trial, condition, task).call('project')).text) as View
  // hosting.plan.list is still out of this view: the comparison, not the list, is what states the allowance
  expect(view.offers.some((o) => o.id.startsWith('hosting.plan.list'))).toBe(false)
  const plans = view.choiceSets.find((s) => s.over === 'hosting.plan')!
  // plan keys are opaque (p1, p2, p3), so Pro is the row whose slug is pro: the comparison names its own members
  const { comparison } = plans
  expect(comparison.rows).toHaveLength(plans.members.length)
  const pro = comparison.rows.findIndex((r) => r.slug === 'pro')
  expect(pro).toBeGreaterThanOrEqual(0)
  const stated = comparison.differ.includes('bandwidthGb')
    ? comparison.rows[pro]!.bandwidthGb
    : comparison.shared.bandwidthGb
  expect(stated).toEqual(expect.any(Number))
  expect(comparison.omitted.attributes).toEqual([])
})

// design (2026-11-18): T6's claim edit cites the facts its statement relies on, so under C, which shows the claim, no
// facts budget cuts bandwidthGb or support from the plans' comparison
test('under C on T6, businessRecommended cites bandwidthGb and support, and facts: 0 keeps both', async () => {
  const trial = await setupTrial(conditions.C, 0, 'T6')
  const claim = trial.runtime.manifest.claims!.find((c) => c.id === 'businessRecommended')!
  expect(claim.cites).toEqual(['bandwidthGb', 'support'])
  const v = (
    await trial.runtime.project({
      ...trial.request,
      principal: trial.principal,
      budget: { facts: 0 },
    })
  ).view() as unknown as View
  const { comparison } = v.choiceSets.find((s) => s.over === 'hosting.plan')!
  for (const a of ['bandwidthGb', 'support']) {
    expect(comparison.omitted.attributes).not.toContain(a)
    expect([...comparison.differ, ...Object.keys(comparison.shared)]).toContain(a)
  }
})
