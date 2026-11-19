import { expect, test } from 'vitest'
import {
  nestChoiceSets,
  sameInformation,
  unnestChoiceSets,
  type NestedView,
  type ViewData,
} from '../src/structure.ts'
import { principalFor } from '../src/lib/resolvers.ts'
import { runtime } from '../src/lib/runtime.ts'
import * as store from '../src/lib/store.ts'

// a condition-A view of T3's first step, shaped as RFC 0002's View: the plan choice set, the bundle and the project
const plan = (key: string, status: string) => ({
  id: `hosting.plan.subscribe@hosting.plan:${key}`,
  revision: `sha256-${key}`,
  capability: 'hosting.plan.subscribe',
  target: { type: 'hosting.plan', key },
  with: { project: 'p_1' },
  availability: { status },
  conditions: [],
  requirements: { authorization: 'met', confirmation: { summary: `Move p_1 to ${key}` } },
  consequential: true,
  claims: [],
  relevance: { level: 'undetermined' },
  alternatives: { count: 1 },
  choiceSet: 'hosting.plan.subscribe@hosting.plan',
})
const viewA: ViewData = {
  revision: 'sha256-view',
  policy: 'exhaustive',
  order: { by: 'canonical' },
  offers: [
    {
      id: 'hosting.bundle.subscribe@hosting.bundle:pro-plus',
      capability: 'hosting.bundle.subscribe',
      availability: { status: 'available' },
      claims: [],
      alternatives: { count: 1 },
    },
    plan('p1', 'unavailable'),
    plan('p2', 'available'),
    plan('p3', 'available'),
    {
      id: 'hosting.project.read@hosting.project:p_1',
      capability: 'hosting.project.read',
      claims: [],
    },
  ],
  choiceSets: [
    {
      id: 'hosting.plan.subscribe@hosting.plan',
      capability: 'hosting.plan.subscribe',
      over: 'hosting.plan',
      members: [
        'hosting.plan.subscribe@hosting.plan:p1',
        'hosting.plan.subscribe@hosting.plan:p2',
        'hosting.plan.subscribe@hosting.plan:p3',
      ],
      order: { by: 'canonical' },
    },
  ],
  omitted: { offers: 0, choiceSets: 0, claims: 3, expand: [] },
}

test('S moves only the choice set members, and undoing it gives back A', () => {
  const s = nestChoiceSets(viewA)
  expect(s.offers.map((o) => o.id)).toEqual([
    'hosting.bundle.subscribe@hosting.bundle:pro-plus',
    'hosting.project.read@hosting.project:p_1',
  ])
  expect(s.choiceSets[0]!.members.map((o) => o.id)).toEqual(viewA.choiceSets[0]!.members)
  expect(sameInformation(viewA, s)).toBe(true)
  // S states its own order truthfully: grouped by target type, with A's order within each group
  expect(s.order).toEqual({ by: 'group', key: 'targetType', within: { by: 'canonical' } })
  expect(unnestChoiceSets(s).choiceSets).toEqual(viewA.choiceSets)
})

const tampered = (change: (s: NestedView) => void) => {
  const s = structuredClone(nestChoiceSets(viewA))
  change(s)
  return sameInformation(viewA, s)
}

test('anything S adds or changes beyond the named move is caught', () => {
  // a label on one plan
  expect(tampered((s) => (s.choiceSets[0]!.members[1]!.label = 'Best value'))).toBe(false)
  // a claim shown that A omits
  expect(
    tampered((s) =>
      (s.choiceSets[0]!.members[1]!.claims as unknown[]).push({ kind: 'recommendation' }),
    ),
  ).toBe(false)
  // a detail
  expect(tampered((s) => (s.offers[0]!.detail = 'Saves 5 USD a month'))).toBe(false)
  // a field on the view
  expect(tampered((s) => (s.highlight = 'hosting.plan.subscribe@hosting.plan:p2'))).toBe(false)
  // a changed order basis, on the view or the choice set
  expect(tampered((s) => (s.order = { by: 'relevance', method: 'basic' }))).toBe(false)
  // a basis that names a claim or a recommendation, even inside a group
  expect(
    tampered(
      (s) =>
        (s.order = {
          by: 'group',
          key: 'targetType',
          within: { by: 'claim', kind: 'recommendation' },
        }),
    ),
  ).toBe(false)
  // a group keyed by free text, or a basis with a field that could carry it
  expect(
    tampered((s) => (s.order = { by: 'group', key: 'best value', within: { by: 'canonical' } })),
  ).toBe(false)
  expect(
    tampered(
      (s) =>
        (s.order = {
          by: 'group',
          key: 'targetType',
          within: { by: 'canonical' },
          note: 'Best value first',
        }),
    ),
  ).toBe(false)
  // S claiming a different order than the one it shows
  expect(tampered((s) => (s.order = { by: 'canonical' }))).toBe(false)
  expect(tampered((s) => (s.choiceSets[0]!.order = { by: 'claim' }))).toBe(false)
  // the members reordered
  expect(tampered((s) => (s.choiceSets[0]!.members = s.choiceSets[0]!.members.toReversed()))).toBe(
    false,
  )
  // a member dropped
  expect(tampered((s) => s.choiceSets[0]!.members.pop())).toBe(false)
})

// each offer's capability, in order
const capabilities = (offers: { id: string }[]) => offers.map((o) => o.id.split('@')[0])

// S's second move, on the real fixture: A's canonical order puts the add-on offers first (the optimum's add-on on
// T6 and T7, RFC 0003 §3.2); S groups them below the project's own offers, with A's information unchanged
test("on the fixture, S moves the add-on offers off the top, and S still carries exactly A's information", async () => {
  for (const order of [
    ['p1', 'p2', 'p3'],
    ['p3', 'p1', 'p2'],
    ['p2', 'p3', 'p1'],
  ] as const) {
    store.reset()
    store.setPlanIds(order)
    const sid = 's_struct'
    const { id } = store.account(sid).project
    const view = (
      await runtime.project({
        principal: principalFor(sid),
        policy: 'exhaustive',
        start: { type: 'hosting.project', key: id },
      })
    ).view() as unknown as ViewData
    const s = nestChoiceSets(view)
    expect(sameInformation(view, s)).toBe(true)
    // in A, an add-on offer is first; in S, every project-targeted offer comes before any add-on offer
    expect(capabilities(view.offers)[0]).toMatch(/^hosting\.addOn\./)
    const sIds = capabilities(s.offers)
    const firstAddOn = sIds.findIndex((c) => c!.startsWith('hosting.addOn.'))
    const lastProject = sIds.findLastIndex((c) =>
      ['hosting.project.read', 'hosting.subscription.cancel', 'hosting.deployment.create'].includes(
        c!,
      ),
    )
    expect(firstAddOn).toBeGreaterThan(lastProject)
    // reordering within a group, or moving an offer across groups, is caught
    const swapped = structuredClone(s)
    const i = sIds.indexOf('hosting.addOn.add')
    ;[swapped.offers[i], swapped.offers[i + 1]] = [swapped.offers[i + 1]!, swapped.offers[i]!]
    expect(sameInformation(view, swapped)).toBe(false)
    const moved = structuredClone(s)
    moved.offers.unshift(moved.offers.splice(firstAddOn, 1)[0]!)
    expect(sameInformation(view, moved)).toBe(false)
  }
})
