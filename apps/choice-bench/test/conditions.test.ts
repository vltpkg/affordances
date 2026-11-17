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
  expect(trial.request).toEqual({ start: trial.project, policy: 'neutral' })
  expect(view.offers.some((o) => o.capability === BUNDLE)).toBe(true)
})
