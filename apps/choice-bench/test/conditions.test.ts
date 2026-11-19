import * as lab from '@affordances/hosting-lab/trial'
import { digest } from '@affordances/ir'
import { builtInPolicies } from '@affordances/runtime'
import { expect, test } from 'vitest'
import { conditions } from '../src/conditions.ts'
import { PERMUTATIONS, permutationFor, setupTrial } from '../src/trial.ts'

const SUBSCRIBE = 'hosting.plan.subscribe'
const BUNDLE = 'hosting.bundle.subscribe'
const firstView = async (id: keyof typeof conditions, index = 0) => {
  const trial = await setupTrial(conditions[id], index)
  const projection = await trial.runtime.project({ principal: trial.principal, ...trial.request })
  return { trial, projection, view: projection.view() }
}

test('every condition sets up a trial, and only F and G change the manifest, each by its one edit', async () => {
  const base = await digest(lab.manifest)
  for (const c of Object.values(conditions)) {
    const { trial } = await firstView(c.id)
    const changed = (await digest(trial.runtime.manifest)) !== base
    expect([c.id, changed]).toEqual([c.id, c.id === 'F' || c.id === 'G'])
  }
})

test('B and C are the runtime’s built-in progressive and advocated, as RFC 0003 §3.1 names them', () => {
  expect(conditions.B.policy).toBe(builtInPolicies.find((p) => p.id === 'progressive'))
  expect(conditions.C.policy).toBe(builtInPolicies.find((p) => p.id === 'advocated'))
  // and D is C without the claims' text
  const { id: _c, description: _cd, claims: _cc, ...c } = conditions.C.policy
  const { id: _d, description: _dd, claims, ...d } = conditions.D.policy
  expect([d, claims]).toEqual([c, 'omitted'])
})

test('every six trials of a cell take each plan-id order once', () => {
  const six = Array.from({ length: 6 }, (_, i) => permutationFor(i).join())
  expect(new Set(six).size).toBe(6)
  expect(permutationFor(6)).toEqual(PERMUTATIONS[0])
  // so each plan holds each id, and sits first, equally often
  for (const position of [0, 1, 2])
    expect(new Set(six.map((p) => p.split(',')[position])).size).toBe(3)
})

test('E: the first view is the plans, bound to the user’s project, and not the bundle', async () => {
  const { trial, view } = await firstView('E')
  expect(view.offers.map((o) => o.capability)).toEqual([SUBSCRIBE, SUBSCRIBE, SUBSCRIBE])
  for (const o of view.offers) expect(o.id).toContain(`?project=${trial.project.key}`)
  expect(view.offers.some((o) => o.capability === BUNDLE)).toBe(false)
})

test('E: the bundle is exactly one counted expansion away, along alternatives', async () => {
  const { projection, view } = await firstView('E')
  const along = view.omitted.expand.filter((e) => e.along === 'alternatives')
  expect(along.length).toBe(view.offers.length)
  for (const e of along) {
    expect(e.count).toBe(1)
    const next = await projection.expand(e)
    expect(next.offers.map((o) => o.capability)).toEqual([BUNDLE])
  }
})

test('A starts from the user’s project, with no bind, and the bundle is in its first view', async () => {
  const { trial, view } = await firstView('A')
  expect(trial.request).toEqual({ start: trial.project, policy: 'exhaustive-claims-omitted' })
  expect(view.offers.some((o) => o.capability === BUNDLE)).toBe(true)
})

test('calibration is exactly §8’s 70: A, C and S on T6 and T7, and A on T3, for Sonnet and Haiku, five each', async () => {
  const { calibrationPlan } = await import('../src/harness.ts')
  const plan = calibrationPlan()
  expect(plan.length).toBe(70)
  expect(new Set(plan.map((t) => t.id)).size).toBe(70)
  const cells = [...new Set(plan.map((t) => `${t.condition}${t.task} ${t.model}`))].toSorted()
  expect(cells).toEqual(
    ['claude-haiku-5-5', 'claude-sonnet-5-5']
      .flatMap((m) => ['AT3', 'AT6', 'AT7', 'CT6', 'CT7', 'ST6', 'ST7'].map((c) => `${c} ${m}`))
      .toSorted(),
  )
  expect(plan.every((t) => t.driver === 'claude-cli')).toBe(true)
})

// a condition's claims on a task, as its trial's manifest has them
const claimsOf = async (id: keyof typeof conditions, task: string) => {
  const trial = await setupTrial(conditions[id], 0, task)
  return (trial.runtime.manifest.claims ?? []).map((c) => ({ id: c.id, applies: c.applies }))
}

test('on T6 and T7 the owner recommends Business, in every condition alike; T3 keeps Pro', async () => {
  for (const task of ['T6', 'T7']) {
    const a = await claimsOf('A', task)
    expect(a).toContainEqual({
      id: 'businessRecommended',
      applies: { eq: [{ path: 'target.slug' }, { value: 'business' }] },
    })
    expect(a.some((c) => c.id === 'proRecommended')).toBe(false)
    // the same claims in C and S, so only C showing them differs
    expect(await claimsOf('C', task)).toEqual(a)
    expect(await claimsOf('S', task)).toEqual(a)
  }
  expect((await claimsOf('A', 'T3')).some((c) => c.id === 'proRecommended')).toBe(true)
  // and the edit changes the digest
  const base = await digest(lab.manifest)
  expect(await digest((await setupTrial(conditions.A, 0, 'T6')).runtime.manifest)).not.toBe(base)
  expect(await digest((await setupTrial(conditions.A, 0, 'T3')).runtime.manifest)).toBe(base)
})
