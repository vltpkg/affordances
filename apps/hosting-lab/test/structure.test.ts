import { expect, test } from 'vitest'
import {
  nestChoiceSets,
  sameInformation,
  unnestChoiceSets,
  type NestedView,
  type ViewData,
} from '../src/structure.ts'

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
  // the order basis is A's, untouched
  expect(s.order).toEqual({ by: 'canonical' })
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
  expect(tampered((s) => (s.choiceSets[0]!.order = { by: 'claim' }))).toBe(false)
  // the members reordered
  expect(tampered((s) => (s.choiceSets[0]!.members = s.choiceSets[0]!.members.toReversed()))).toBe(
    false,
  )
  // a member dropped
  expect(tampered((s) => s.choiceSets[0]!.members.pop())).toBe(false)
})
