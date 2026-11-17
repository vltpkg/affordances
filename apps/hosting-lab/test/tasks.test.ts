import { expect, test } from 'vitest'
import { evaluate } from '@affordances/ir'
import { plans, withPlanIds } from '../src/catalog.ts'
import { manifest } from '../src/manifest.ts'
import {
  endStates,
  groundTruth,
  label,
  monthlyUsd,
  susceptible,
  tasks,
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
