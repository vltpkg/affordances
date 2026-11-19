import { expect, test } from 'vitest'
import { conditions, type Condition } from '../src/conditions.ts'
import { controlFor, firstViewOffers, offerSetCheck } from '../src/offerset.ts'

// the offer-set preflight (intake, 2026-11-18, ruling 3): a condition's first view offers what its control's does. The
// control is A, or A with only the scope and start change the condition declares

test('C as built refuses: its advocated scope leaves hosting.plan.list out of the first view, undeclared', async () => {
  expect(await offerSetCheck(['C'], 'T6')).toEqual([
    {
      condition: 'C',
      control: 'exhaustive-claims-omitted',
      // and, since M8e's T8 fixture is in hosting-lab's manifest, the regions' offers too. M5's records were made
      // without them, from their own pinned export, and re-score unchanged
      onlyInControl: [
        'hosting.plan.list',
        'hosting.region.read@hosting.region',
        'hosting.region.read@hosting.region:eu-west',
        'hosting.region.read@hosting.region:us-east',
      ],
      onlyInCondition: [],
    },
  ])
})

test('D refuses for the same reason: it inherits the advocated scope', async () => {
  expect((await offerSetCheck(['D'], 'T6')).map((p) => p.condition)).toEqual(['D'])
})

test('every other condition matches its control, on every task it runs', async () => {
  for (const task of ['T3', 'T6', 'T7'])
    expect(await offerSetCheck(['A', 'B', 'E', 'S', 'C-full-scope', 'A-scope'], task)).toEqual([])
  expect(await offerSetCheck(['F', 'G'], 'T1')).toEqual([])
})

// intake's two equalities (2026-11-18): the exploratory cells decompose C into its two factors
test('C-full-scope’s first view offers exactly what A’s does, and A-scope’s exactly what C’s does', async () => {
  for (const task of ['T3', 'T6', 'T7']) {
    const a = await firstViewOffers(conditions.A, task)
    const c = await firstViewOffers(conditions.C, task)
    expect(await firstViewOffers(conditions['C-full-scope'], task)).toEqual(a)
    expect(await firstViewOffers(conditions['A-scope'], task)).toEqual(c)
    expect(a).toContain('hosting.plan.list')
    expect(c).not.toContain('hosting.plan.list')
  }
})

test('declaring scope excuses only that scope: an undeclared budget that cuts offers still refuses', async () => {
  const declared = conditions['A-scope']
  const budgeted: Condition = {
    ...declared,
    policy: { ...declared.policy, id: 'neighborhood-budgeted', budget: { offers: 3 } },
  }
  const control = controlFor(budgeted)
  expect(control.policy).toMatchObject({ scope: 'neighborhood', depth: 1 })
  expect(control.policy).not.toHaveProperty('budget')
  const expected = await firstViewOffers(control, 'T6')
  const offers = await firstViewOffers(budgeted, 'T6')
  expect(offers.length).toBeLessThan(expected.length)
})

test('C-full-scope differs from C in its scope alone, and A-scope from A in its scope alone', () => {
  const { id: _c, description: _cd, scope: cs, depth: cdepth, ...c } = conditions.C.policy
  const {
    id: _k,
    description: _kd,
    scope: ks,
    depth: kdepth,
    ...k
  } = conditions['C-full-scope'].policy
  expect(k).toEqual(c)
  expect([cs, cdepth, ks, kdepth]).toEqual(['neighborhood', 1, 'exhaustive', undefined])
  const { id: _a, description: _ad, scope: as, depth: adepth, ...a } = conditions.A.policy
  const { id: _s, description: _sd, scope: ss, depth: sdepth, ...s } = conditions['A-scope'].policy
  expect(s).toEqual(a)
  expect([as, adepth, ss, sdepth]).toEqual(['exhaustive', undefined, 'neighborhood', 1])
})
