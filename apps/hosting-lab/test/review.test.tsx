import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, test } from 'vitest'
import { addOns, bundles } from '../src/catalog.ts'
import { ConfirmationSummary } from '../src/components/confirmation.tsx'
import { principalFor } from '../src/lib/resolvers.ts'
import {
  REVIEWED,
  confirmReviewed,
  review,
  reviewUrl,
  type ReviewedAction,
} from '../src/lib/review.ts'
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

// a Confirm, handled (the planner, 16:04Z): checked again, run only on the summary the person saw, and a refusal is an
// answer for the page, never a throw
const confirmForm = (fields: Record<string, string>, seen: string | undefined) => {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  if (seen !== undefined) form.set('seen', seen)
  return form
}
const pro = () => store.currentPlans().find((p) => p.slug === 'pro')!
const refuse = async () => {
  throw new store.Refused('Pro is already the plan')
}
const fail = async () => {
  throw new Error('the disk is full')
}

test('a Confirm on the summary shown runs the call, with only its own fields', async () => {
  const { project } = store.account(sid)
  const principal = principalFor(sid)
  const fields = { plan: pro().id, projectId: project.id }
  const { summary } = await review(principal, 'subscribe', fields)
  const ran: Record<string, string>[] = []
  const outcome = await confirmReviewed(
    principal,
    'subscribe',
    confirmForm(fields, summary),
    async (form) => {
      ran.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])))
      store.subscribePlan(store.account(sid).id, project.id, pro().id)
    },
  )
  expect(outcome).toBe('confirmed')
  expect(ran).toEqual([fields])
  expect(store.account(sid).project.plan).toBe('pro')
})

test("a second tab's stale Confirm is answered 'refused', with nothing charged twice and nothing thrown", async () => {
  const { project } = store.account(sid)
  const principal = principalFor(sid)
  const fields = { plan: pro().id, projectId: project.id }
  // both tabs reviewed the same summary; the first confirmed
  const { summary } = await review(principal, 'subscribe', fields)
  const subscribe = async () =>
    void store.subscribePlan(store.account(sid).id, project.id, pro().id)
  expect(
    await confirmReviewed(principal, 'subscribe', confirmForm(fields, summary), subscribe),
  ).toBe('confirmed')
  const charges = store.account(sid).ledger.length
  // the second: the runtime's check now refuses it, or the store does; either way an answer, never a throw
  expect(
    await confirmReviewed(principal, 'subscribe', confirmForm(fields, summary), subscribe),
  ).toBe('refused')
  expect(store.account(sid).ledger.length).toBe(charges)
})

test("a store refusal the runtime didn't foresee is answered 'refused', and any other error still throws", async () => {
  const { project } = store.account(sid)
  const principal = principalFor(sid)
  const fields = { plan: pro().id, projectId: project.id }
  const { summary } = await review(principal, 'subscribe', fields)
  expect(await confirmReviewed(principal, 'subscribe', confirmForm(fields, summary), refuse)).toBe(
    'refused',
  )
  await expect(
    confirmReviewed(principal, 'subscribe', confirmForm(fields, summary), fail),
  ).rejects.toThrow('the disk is full')
})

test("a summary that's changed since it was shown isn't run: the page shows the new one", async () => {
  const { project } = store.account(sid)
  const principal = principalFor(sid)
  const fields = { plan: pro().id, projectId: project.id }
  let ran = false
  const run = async () => void (ran = true)
  expect(
    await confirmReviewed(
      principal,
      'subscribe',
      confirmForm(fields, 'Move to Pro, for 1 USD'),
      run,
    ),
  ).toBe('changed')
  // no summary posted at all is a change too
  expect(await confirmReviewed(principal, 'subscribe', confirmForm(fields, undefined), run)).toBe(
    'changed',
  )
  expect(ran).toBe(false)
})
