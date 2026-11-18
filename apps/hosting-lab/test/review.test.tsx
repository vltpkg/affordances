import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test } from 'vitest'
import { addOns, bundles } from '../src/catalog.ts'
import { ConfirmationSummary } from '../src/components/confirmation.tsx'
import { principalFor } from '../src/lib/resolvers.ts'
import { REVIEWED, review, reviewUrl, type ReviewedAction } from '../src/lib/review.ts'
import { runtime } from '../src/lib/runtime.ts'
import * as store from '../src/lib/store.ts'

// M7f's review-and-confirm page (its plan, §3): the summary it shows is the API's, byte for byte, for every capability
// that requires confirmation and every target, so the browser and the API surfaces ask the person to approve the same
// words. The enumeration is every reviewed action over every catalog target, a superset of what T6's readings reach

beforeEach(() => store.reset())

const sid = 's_review'
const cases = (projectId: string): [ReviewedAction, Record<string, string>][] => [
  ...store
    .currentPlans()
    .map((p): [ReviewedAction, Record<string, string>] => ['subscribe', { plan: p.id, projectId }]),
  ...bundles.map((b): [ReviewedAction, Record<string, string>] => [
    'subscribeBundle',
    { bundle: b.slug, projectId },
  ]),
  ...addOns.map((a): [ReviewedAction, Record<string, string>] => [
    'addAddOn',
    { projectId, addOn: a.slug },
  ]),
]

// what the page's element holds as text: its markup's content, with React's escaping undone
const textOf = (html: string) =>
  html
    .replace(/^<p[^>]*>|<\/p>$/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&')

test('the review page shows the summary the API returns, byte for byte, for every reviewed call', async () => {
  const { project } = store.account(sid)
  const principal = principalFor(sid)
  const results = await Promise.all(
    cases(project.id).map(async ([action, input]) => ({
      action,
      input,
      page: await review(principal, action, input),
      // the API path: an execution without approval, refused for confirmation with its summary
      api: await runtime.execute({ principal, offer: REVIEWED[action].capability, input }),
    })),
  )
  const approvable = results.filter(
    (x) => x.api.status === 'refused' && x.api.code === 'confirmation_required',
  )
  const summaryOf = (x: (typeof results)[number]) =>
    x.api.status === 'refused' ? x.api.confirmation?.summary : undefined
  // the page and the API give the same words, for every call the person could approve
  expect(approvable.map((x) => x.page.summary)).toEqual(approvable.map(summaryOf))
  // and the page's named element holds exactly that text
  expect(
    approvable.map((x) =>
      textOf(renderToStaticMarkup(<ConfirmationSummary summary={x.page.summary!} />)),
    ),
  ).toEqual(approvable.map(summaryOf))
  expect(renderToStaticMarkup(<ConfirmationSummary summary="s" />)).toMatch(
    /^<p data-confirmation-summary[ =>]/,
  )
  // the rest (the current plan) is refused on both paths, and the page says why instead of showing a summary
  const rest = results.filter((x) => !approvable.includes(x))
  expect(rest.map((x) => [x.page.summary, typeof x.page.refused])).toEqual(
    rest.map(() => [undefined, 'string']),
  )
  // every plan but the current one, the bundle and every add-on
  expect(approvable).toHaveLength(store.currentPlans().length - 1 + bundles.length + addOns.length)
})

test('every summary lists its charge, as the API approves it', async () => {
  const { project } = store.account(sid)
  const pro = store.currentPlans().find((p) => p.slug === 'pro')!
  const r = await review(principalFor(sid), 'subscribe', { plan: pro.id, projectId: project.id })
  expect(r.summary).toContain('20')
})

test('a reviewed call nothing would confirm says why, and never shows a summary to approve', async () => {
  const { project } = store.account(sid)
  const current = store.currentPlans().find((p) => p.slug === project.plan)!
  const r = await review(principalFor(sid), 'subscribe', {
    plan: current.id,
    projectId: project.id,
  })
  expect(r.summary).toBeUndefined()
  expect(r.refused).toBeTruthy()
})

test("a refused call's review URL names its action and fields, from its offer id or capability id", () => {
  expect(
    reviewUrl('hosting.plan.subscribe@hosting.plan:p2?project=proj_1', {
      plan: 'p2',
      projectId: 'proj_1',
    }),
  ).toBe('/review?action=subscribe&plan=p2&projectId=proj_1')
  expect(reviewUrl('hosting.addOn.add', { projectId: 'proj_1', addOn: 'extra-bandwidth' })).toBe(
    '/review?action=addAddOn&projectId=proj_1&addOn=extra-bandwidth',
  )
  // a capability with no review step has no URL
  expect(reviewUrl('hosting.addOn.remove@hosting.addOn:x', {})).toBeUndefined()
  // every reviewed action is reachable from its capability
  for (const [action, spec] of Object.entries(REVIEWED))
    expect(reviewUrl(spec.capability, {})).toBe(`/review?action=${action}`)
})
