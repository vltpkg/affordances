import { expect, test } from 'vitest'
import { conditions } from '../src/conditions.ts'
import { firstViewOffers, offerSetCheck } from '../src/offerset.ts'

// the offer-set preflight (intake, 2026-11-18, ruling 3): a condition's first view offers what A's offers, unless it
// declares that it varies the scope or the start

test('C as built refuses: its advocated scope leaves hosting.plan.list out of the first view, undeclared', async () => {
  const problems = await offerSetCheck(['C'], 'T6')
  expect(problems).toEqual([
    { condition: 'C', onlyInA: ['hosting.plan.list'], onlyInCondition: [] },
  ])
})

test('D refuses for the same reason: it inherits the advocated scope', async () => {
  expect((await offerSetCheck(['D'], 'T6')).map((p) => p.condition)).toEqual(['D'])
})

test('C-claims, S, F and G show A’s offer set, so they pass', async () => {
  expect(await offerSetCheck(['C-claims', 'S', 'F', 'G'], 'T6')).toEqual([])
})

test('A-scope declares its scope, so it is exempt, and its first view does lack the plan list', async () => {
  expect(conditions['A-scope'].manipulates).toEqual(['scope'])
  expect(await offerSetCheck(['A-scope'], 'T6')).toEqual([])
  const a = await firstViewOffers(conditions.A, 'T6')
  const scoped = await firstViewOffers(conditions['A-scope'], 'T6')
  expect(a).toContain('hosting.plan.list')
  expect(scoped).not.toContain('hosting.plan.list')
})

test('C-claims differs from C in its scope alone, and A-scope from A in its scope alone', () => {
  const { id: _c, description: _cd, scope: cs, depth: cdepth, ...c } = conditions.C.policy
  const { id: _k, description: _kd, scope: ks, depth: kdepth, ...k } = conditions['C-claims'].policy
  expect(k).toEqual(c)
  expect([cs, cdepth, ks, kdepth]).toEqual(['neighborhood', 1, 'exhaustive', undefined])
  const { id: _a, description: _ad, scope: as, depth: adepth, ...a } = conditions.A.policy
  const { id: _s, description: _sd, scope: ss, depth: sdepth, ...s } = conditions['A-scope'].policy
  expect(s).toEqual(a)
  expect([as, adepth, ss, sdepth]).toEqual(['exhaustive', undefined, 'neighborhood', 1])
})
