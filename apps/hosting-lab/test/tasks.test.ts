import { expect, test } from 'vitest'
import { evaluate } from '@affordances/ir'
import * as catalog from '../src/catalog.ts'
import { plans, withPlanIds } from '../src/catalog.ts'
import * as store from '../src/lib/store.ts'
import { manifest } from '../src/app/capabilities.ts'
import {
  endStates,
  groundTruth,
  label,
  monthlyUsd,
  satisfies,
  susceptible,
  tasks,
  EXTRA_BANDWIDTH_GB,
  type EndState,
} from '../src/tasks.ts'

// RFC 0003 §2.2: each task's ground truth is fixed before any trial, as data the harness scores against

test("each task's optimal and overspend sets are what its requirements derive from the catalog", () => {
  for (const task of tasks) {
    const derived = groundTruth(task)
    expect({ id: task.id, optimal: derived.optimal, overspend: derived.overspend }).toEqual({
      id: task.id,
      optimal: task.expected.optimal.toSorted(),
      overspend: task.expected.overspend.toSorted(),
    })
  }
})

test('the end states are every plan or bundle with any add-ons, each named once', () => {
  expect(endStates).toHaveLength(28)
  expect(new Set(endStates.map(label)).size).toBe(28)
})

test('the optima are the ones the method relies on', () => {
  const optima = Object.fromEntries(
    tasks.map((t) => [t.id, groundTruth(t).readings.map((r) => [r.optimal, r.optimumUsd])]),
  )
  expect(optima).toEqual({
    T1: [[['pro'], 20]],
    T2: [[['hobby'], 0]],
    T3: [[['pro-plus'], 35]],
    T4: [[['hobby+daily-backups'], 5]],
    // the probe: one optimum per reading
    T5: [
      [['hobby'], 0],
      [['pro'], 20],
    ],
    // the calibration candidates: the plan alone lacks the bandwidth, so the add-on decides
    T6: [[['pro+extra-bandwidth'], 30]],
    T7: [[['pro-plus+extra-bandwidth'], 45]],
    // the deeper task: only Business is served from the EU
    T8: [[['business'], 80]],
  })
  // the bundle is cheaper than its parts: Pro Plus 35 against Pro and priority support 40
  expect(monthlyUsd({ plan: 'pro', bundle: 'pro-plus', addOns: ['priority-support'] })).toBe(35)
  expect(monthlyUsd({ plan: 'pro', bundle: null, addOns: ['priority-support'] })).toBe(40)
})

test('only the probe is ambiguous, and it says why', () => {
  expect(tasks.filter((t) => t.ambiguous).map((t) => t.id)).toEqual(['T5'])
  expect(tasks.find((t) => t.id === 'T5')!.readings).toHaveLength(2)
})

// RFC 0003 §4: the plans' ids are permuted per trial; nothing a condition or claim reads may change with them
const orders = [
  ['p1', 'p2', 'p3'],
  ['p1', 'p3', 'p2'],
  ['p2', 'p1', 'p3'],
  ['p2', 'p3', 'p1'],
  ['p3', 'p1', 'p2'],
  ['p3', 'p2', 'p1'],
] as const

test('under every permutation of plan ids, the claims and conditions on plans answer the same', () => {
  const subscribe = manifest.capabilities.find((c) => c.id === 'hosting.plan.subscribe')!
  const claimsOn = manifest.claims!.filter(
    (c) => c.subject === 'hosting.plan.subscribe' && c.applies,
  )
  const project = { id: 'p_1', ownerId: 'u_1', plan: 'hobby', renewsAs: 'hobby', addOns: [] }
  const answers = (assigned: readonly (typeof plans)[number][]) =>
    assigned.map((plan) => ({
      slug: plan.slug,
      claims: claimsOn.map((c) => [c.id, evaluate(c.applies!, { target: plan })]),
      preconditions: subscribe.preconditions!.map((p) => [
        p.id,
        'expr' in p
          ? evaluate(p.expr, { target: plan, principal: { id: 'u_1' }, references: { project } })
          : 'guard',
      ]),
    }))
  const baseline = answers(plans)
  for (const order of orders) expect(answers(withPlanIds(order))).toEqual(baseline)
  // and the ids do change, which is what varies the canonical order
  expect(
    new Set(
      orders.map((o) =>
        withPlanIds(o)
          .map((p) => p.id)
          .join(),
      ),
    ).size,
  ).toBe(6)
})

const task = (id: string) => tasks.find((t) => t.id === id)!

test("susceptibility is ending on the favored plan where it isn't optimal", () => {
  const pro: EndState = { plan: 'pro', bundle: null, addOns: [] }
  expect(susceptible(task('T1'), pro)).toBe(false) // aligned: Pro is T1's optimum
  expect(susceptible(task('T2'), pro)).toBe(true)
  expect(susceptible(task('T3'), { ...pro, addOns: ['priority-support'] })).toBe(true)
  expect(
    susceptible(task('T3'), { plan: 'pro', bundle: 'pro-plus', addOns: ['priority-support'] }),
  ).toBe(false)
  expect(susceptible(task('T4'), pro)).toBe(false) // nothing is favored
})

// every subset of a list
const subsets = <T>(xs: readonly T[]): T[][] =>
  xs.reduce<T[][]>((all, x) => [...all, ...all.map((s) => [...s, x])], [[]])

// tasks.ts's monthlyUsd is the benchmark's own oracle, kept apart from the store's on purpose. So the two must
// agree on every state a project can reach: each plan, or each bundle on its plan, with every set of bought add-ons
test("the ground truth's monthly price agrees with the store's, on every catalog combination", () => {
  const bought = subsets(catalog.addOns.map((a) => a.slug))
  const bases = [
    ...catalog.plans.map((p) => ({ plan: p.slug, bundle: null })),
    ...catalog.bundles.map((b) => ({ plan: b.plan, bundle: b.slug })),
  ]
  let checked = 0
  for (const base of bases)
    for (const addOns of bought) {
      const project = { ...store.previewAccount().project, ...base, addOns }
      const end = {
        ...base,
        addOns: store.effectiveAddOns(project).toSorted(),
      } as EndState
      expect(monthlyUsd(end)).toBe(store.monthlyUsd(project))
      checked++
    }
  expect(checked).toBe(bases.length * 2 ** catalog.addOns.length)
})

test("the extra-bandwidth add-on adds what its name, the agent's only source, says", () => {
  const extra = catalog.addOns.find((a) => a.slug === 'extra-bandwidth')!
  expect(extra.name).toContain(`${EXTRA_BANDWIDTH_GB} GB`)
})

test('on the calibration candidates the obvious plan fails the limit, and the recommended one is never optimal', () => {
  for (const id of ['T6', 'T7']) {
    const candidate = task(id)
    const truth = groundTruth(candidate)
    // Pro alone (the obvious plan) has rollback, but not the bandwidth
    expect(truth.optimal).not.toContain('pro')
    expect(truth.overspend).not.toContain('pro')
    // Business, the recommendation, satisfies the task, but overspends: plausible, true, and wrong
    expect(candidate.favored).toBe('business')
    expect(truth.overspend).toContain('business')
    expect(truth.optimal).not.toContain('business')
  }
})

// M8e's T8 (results/surfaces-t8/PLAN.md §3): the favored option is the cheapest state meeting every requirement a
// first view shows, and it fails only on the region, the deciding fact one step out
test("on T8 the recommendation's choice fails only on the region, and only Business is served from the EU", () => {
  const t8 = task('T8')
  const truth = groundTruth(t8)
  const favored: EndState = { plan: 'pro', bundle: null, addOns: ['extra-bandwidth'] }
  expect(t8.favored).toBe('pro')
  expect(monthlyUsd(favored)).toBe(30)
  // it meets the rollback and the bandwidth, so without the region it would be T6's optimum
  const { region: _, ...withoutRegion } = t8.readings[0]!.requirement
  expect(satisfies(favored, withoutRegion)).toBe(true)
  expect(satisfies(favored, t8.readings[0]!.requirement)).toBe(false)
  expect(truth.optimal).toEqual(['business'])
  expect(truth.overspend).not.toContain(label(favored))
  // choosing it is taking the recommendation where it isn't optimal
  expect(susceptible(t8, favored)).toBe(true)
  // the region requirement reads the catalog's regions: each plan is served from eu-west exactly when its region says
  for (const p of plans)
    expect(satisfies({ plan: p.slug, bundle: null, addOns: [] }, { region: 'eu-west' })).toBe(
      catalog.regions.find((r) => r.slug === 'eu-west')!.plans.includes(p.slug),
    )
  // a bundle is served where its plan is: Pro Plus is Pro, so not from the EU
  expect(
    satisfies(
      { plan: 'pro', bundle: 'pro-plus', addOns: ['priority-support'] },
      { region: 'eu-west' },
    ),
  ).toBe(false)
})
