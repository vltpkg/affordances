import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ChoiceSetComparison, type InspectedSet } from '../src/components/comparison.tsx'

// RFC 0002 §6.6's comparison as the inspector renders it: a member per row, a differing attribute per column, the
// shared ones once, an unsupplied cell said so, and a cut named

const set = {
  id: 'hosting.plan.subscribe@hosting.plan',
  capability: 'hosting.plan.subscribe',
  over: 'hosting.plan',
  members: ['hosting.plan.subscribe@hosting.plan:p1', 'hosting.plan.subscribe@hosting.plan:p2'],
  order: { by: 'canonical' },
  inView: true,
  comparison: {
    differ: ['name', 'priceUsd', 'bandwidthGb'],
    rows: [
      { name: 'Hobby', priceUsd: 0, bandwidthGb: 10 },
      { name: 'Pro', priceUsd: 20 },
    ],
    shared: { rollback: true },
    unsupplied: [{ member: 'hosting.plan.subscribe@hosting.plan:p2', attributes: ['bandwidthGb'] }],
    omitted: { attributes: ['support'] },
  },
  marks: { cited: ['bandwidthGb'], read: ['priceUsd', 'name'] },
} as unknown as InspectedSet
const offers = set.members.map((id, n) => ({
  id,
  target: { type: 'hosting.plan', key: `p${n + 1}` },
}))

const html = renderToStaticMarkup(
  <ChoiceSetComparison set={set} offers={offers as never} policy="advocated" />,
)

test('every member is a row and every differing attribute a column, with its marks', () => {
  expect(html).toContain('<th scope="row"')
  expect((html.match(/<th scope="row"/g) ?? []).length).toBe(2)
  for (const a of ['name', 'priceUsd', 'bandwidthGb']) expect(html).toContain(`>${a}<`)
  expect(html).toMatch(/bandwidthGb<span[^>]*>· cited/)
  expect(html).toMatch(/priceUsd<span[^>]*>· read/)
  expect(html).toContain('>Pro<')
})

test("an unsupplied cell says so, never blank and never 'undefined'", () => {
  expect(html).toContain('aria-label="bandwidthGb not supplied"')
  expect(html).not.toContain('undefined')
})

test('shared values are stated once, and a cut column is named', () => {
  expect(html).toContain('Same for every member: rollback true')
  expect(html).toContain('Cut by the request&#x27;s facts limit: support')
})
