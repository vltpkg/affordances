import { expect, test } from 'vitest'
import type { BrowserLoad } from '../src/browser-server.ts'
import { browserRequestsOf, browsingLoad, firstRequestAt } from '../src/browser.ts'

// the browser surface's request events and flags (surfaces/PLAN.md §5), from its record's loads and confirms

const at = (path: string, t: number): BrowserLoad => {
  const u = new URL(path, 'http://127.0.0.1:3913')
  return {
    url: u.href,
    at: t,
    ...(u.pathname === '/review' && { review: Object.fromEntries(u.searchParams.entries()) }),
  }
}
const pro = '/review?action=subscribe&plan=p2&projectId=j1'
const business = '/review?action=subscribe&plan=p3&projectId=j1'
const asRequest = (plan: string) => ({
  capability: 'hosting.plan.subscribe',
  input: { plan, projectId: 'j1' },
})

test('the first-load rule: each review load’s selection, in order, once; the confirm-load rule: the load before each confirm', () => {
  const record = {
    loads: [at('/plans', 1), at(business, 2), at('/plans', 3), at(pro, 4), at('/plans', 6)],
    confirms: [{ call: 5, at: 5 }],
  }
  expect(browserRequestsOf(record, 'first-load')).toEqual([asRequest('p3'), asRequest('p2')])
  expect(browserRequestsOf(record, 'confirm-load')).toEqual([asRequest('p2')])
  expect(firstRequestAt(record)).toBe(2)
  // a review load whose action the app doesn't bind is no request
  expect(
    browserRequestsOf({ loads: [at('/review?action=nothing', 1)], confirms: [] }, 'first-load'),
  ).toEqual([])
})

test('a browsing load: a review load, then without a confirm, one carrying a different selection', () => {
  expect(
    browsingLoad({ loads: [at(business, 1), at('/plans', 2), at(pro, 3)], confirms: [] }),
  ).toBe(true)
  // the same selection again isn't browsing
  expect(browsingLoad({ loads: [at(pro, 1), at('/plans', 2), at(pro, 3)], confirms: [] })).toBe(
    false,
  )
  // a confirm between them: a purchase, then another, not a browse
  expect(
    browsingLoad({
      loads: [at(business, 1), at('/plans', 3), at(pro, 4)],
      confirms: [{ call: 1, at: 2 }],
    }),
  ).toBe(false)
})
