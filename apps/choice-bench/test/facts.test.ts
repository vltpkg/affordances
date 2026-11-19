import { describe, expect, test } from 'vitest'
import {
  holdsPhrase,
  pageShowsServedFrom,
  parseAria,
  showsFact,
  showsInTree,
  showsRegionPlans,
  showsServedFrom,
} from '../src/facts.ts'

// §2's deciding facts as each surface shows them, by one matcher per kind of result

test('a structured result shows a fact when one object holds the slug and the value together', () => {
  const view = {
    comparison: {
      rows: [
        { slug: 'hobby', bandwidthGb: 10 },
        { slug: 'pro', bandwidthGb: 100 },
      ],
    },
  }
  expect(showsFact(view, 'pro', 'bandwidthGb', 100)).toBe(true)
  expect(showsFact(view, 'pro', 'bandwidthGb', 10)).toBe(false)
  // the value elsewhere, without the slug beside it, isn't Pro's
  expect(
    showsFact({ addOn: { slug: 'extra-bandwidth', bandwidthGb: 100 } }, 'pro', 'bandwidthGb', 100),
  ).toBe(false)
})

// an add-on's offer, with its rendered summary
const offer = (key: string, summary: string) => ({
  id: `hosting.addOn.add@hosting.addOn:${key}`,
  target: { type: 'hosting.addOn', key },
  requirements: { confirmation: { summary } },
})

test('a price also shows in a targeting offer’s rendered summary, ffb00260’s rule, and only there', () => {
  const view = {
    offers: [
      offer('daily-backups', 'Add Daily backups to j1, for 5 USD a month. Charges: 5 USD now'),
    ],
  }
  expect(showsFact(view, 'daily-backups', 'priceUsd', 5)).toBe(true)
  // the planner (16:53Z): only the offer that TARGETS the item counts. A different offer's summary naming the same
  // price, here another add-on's at 5 USD, doesn't
  const other = {
    offers: [offer('extra-bandwidth', 'Add Extra bandwidth to j1, for 5 USD a month')],
  }
  expect(showsFact(other, 'daily-backups', 'priceUsd', 5)).toBe(false)
  // another item's offer, or a price that's only part of a number, doesn't count
  expect(showsFact(view, 'extra-bandwidth', 'priceUsd', 5)).toBe(false)
  expect(
    showsFact(
      { offers: [offer('daily-backups', 'for 15 USD a month')] },
      'daily-backups',
      'priceUsd',
      5,
    ),
  ).toBe(false)
  // and a summary is never read for a fact that isn't a price
  expect(showsFact(view, 'daily-backups', 'bandwidthGb', 5)).toBe(false)
})

// a plans page as Playwright 1.64's ariaSnapshot({ mode: 'ai' }) renders it
const PAGE = `- main [ref=e2]:
  - heading "Plans" [level=1] [ref=e3]
  - list [ref=e4]:
    - listitem [ref=e5]:
      - heading "Hobby" [level=2] [ref=e6]
      - paragraph [ref=e7]: Free
      - listitem [ref=e8]: 10 GB bandwidth
    - listitem [ref=e9]:
      - heading "Pro" [level=2] [ref=e10]
      - paragraph [ref=e11]: $20 a month
      - listitem [ref=e12]: 100 GB bandwidth
      - link "Move to Pro" [ref=e13] [cursor=pointer]:
        - /url: /review?action=subscribe&plan=p2
    - listitem [ref=e14]:
      - heading "Business" [level=2] [ref=e15]
      - paragraph [ref=e16]: $80 a month
      - listitem [ref=e17]: 1,000 GB bandwidth
  - region "Add-ons" [ref=e18]:
    - listitem [ref=e19]:
      - heading "Extra bandwidth, 100 GB" [level=3] [ref=e20]`
const PLANS = ['Hobby', 'Pro', 'Business']

test('the browser’s matcher: the smallest node holding the label and its value holds no other label of its kind', () => {
  const tree = parseAria(PAGE)
  expect(showsInTree(tree, 'Pro', '100 GB', PLANS)).toBe(true)
  expect(showsInTree(tree, 'Pro', '$20 a month', PLANS)).toBe(true)
  // another row's value: the smallest node holding both is the list, which holds the other plans
  expect(showsInTree(tree, 'Pro', '10 GB', PLANS)).toBe(false)
  expect(showsInTree(tree, 'Pro', '$80 a month', PLANS)).toBe(false)
  // names are exact: 'Move to Pro' and 'Extra bandwidth, 100 GB' are neither the label nor the value
  expect(
    showsInTree(
      parseAria(PAGE.replace('- heading "Pro" [level=2] [ref=e10]\n', '')),
      'Pro',
      '100 GB',
      PLANS,
    ),
  ).toBe(false)
  expect(showsInTree(tree, 'Business', '1,000 GB', PLANS)).toBe(true)
})

test('the snapshot parses to its tree, annotations dropped', () => {
  const tree = parseAria(PAGE)
  const pro = tree.children[0]!.children[1]!.children[1]!
  expect(pro).toMatchObject({
    role: 'listitem',
    children: [
      { role: 'heading', name: 'Pro' },
      { text: '$20 a month' },
      { text: '100 GB bandwidth' },
      { role: 'link', name: 'Move to Pro' },
    ],
  })
})

test('a value is a whole phrase of a node’s text (design, 15:19Z)', () => {
  expect(holdsPhrase('$120 a month', '$20 a month')).toBe(false)
  expect(holdsPhrase('100 GB bandwidth', '10 GB')).toBe(false)
  expect(holdsPhrase('100 GB bandwidth', '100 GB')).toBe(true)
  expect(holdsPhrase('$20 a month, included in your bundle', '$20 a month')).toBe(true)
  expect(holdsPhrase('1,000 GB bandwidth', '000 GB')).toBe(false)
  expect(holdsPhrase('Free', 'Free')).toBe(true)
})

// a plan's page as the browser's snapshot renders it (hosting-lab's /plans/<slug>, bffc4fdf)
const page = (items: string[], heading = 'Pro') =>
  parseAria(
    [
      `- heading "${heading}" [level=1] [ref=e1]`,
      '- paragraph [ref=e2]: $20 a month',
      // as Playwright 1.64's ai snapshot renders hosting-lab's page: the region unnamed, its heading inside it
      '- region [ref=e3]:',
      '  - heading "Served from" [level=2] [ref=e4]',
      '  - list [ref=e5]:',
      ...items.map((t, i) => `    - listitem [ref=e${6 + i}]: ${t}`),
    ].join('\n'),
  )

// T8's regionSeen (results/surfaces-t8/PLAN.md §5, as clarified): the fact that rules Pro out, as a complete list. On the
// graph surfaces, EU West's region object with plans exactly ['business']; on the pages, Pro's served-from list exactly
// ['US East (US)'], and v0's graph for it with servedFrom slugs exactly ['us-east']
describe('T8: the deciding fact as a complete list', () => {
  const euWest = { slug: 'eu-west', name: 'EU West' }
  test('a region object or a comparison row with exactly its plans, and nothing short of it', () => {
    // a comparison's row carries no key: it's named by its name
    const row = { rows: [{ name: 'EU West', jurisdiction: 'EU', plans: ['business'] }] }
    expect(showsRegionPlans(row, euWest, ['business'])).toBe(true)
    expect(
      showsRegionPlans({ region: { slug: 'eu-west', plans: ['business'] } }, euWest, ['business']),
    ).toBe(true)
    for (const near of [
      { rows: [{ name: 'EU West', plans: ['business', 'pro'] }] },
      { rows: [{ name: 'US East', plans: ['business'] }] },
      { rows: [{ name: 'EU West', plans: [] }] },
      { rows: [{ name: 'EU West', plans: 'business' }] },
    ])
      expect(showsRegionPlans(near, euWest, ['business'])).toBe(false)
  })

  test("v0's graph for Pro's page, with exactly its regions", () => {
    const graph = {
      entities: {
        plan: { slug: 'pro', name: 'Pro', priceUsd: 20 },
        servedFrom: [{ slug: 'us-east', name: 'US East', jurisdiction: 'US' }],
      },
    }
    expect(showsServedFrom(graph, 'pro', ['us-east'])).toBe(true)
    expect(showsServedFrom(graph, 'business', ['us-east'])).toBe(false)
    expect(showsServedFrom(graph, 'pro', ['us-east', 'eu-west'])).toBe(false)
  })

  test("Pro's page in the agent's snapshot: its heading, and its 'Served from' list exactly", () => {
    expect(pageShowsServedFrom(page(['US East (US)']), 'Pro', ['US East (US)'])).toBe(true)
    expect(
      pageShowsServedFrom(page(['US East (US)', 'EU West (EU)']), 'Pro', ['US East (US)']),
    ).toBe(false)
    expect(pageShowsServedFrom(page(['US East (US)'], 'Business'), 'Pro', ['US East (US)'])).toBe(
      false,
    )
    expect(pageShowsServedFrom(page([]), 'Pro', ['US East (US)'])).toBe(false)
  })
})

// Pro's page as Playwright 1.64 snapshots hosting-lab's real /plans/pro (bffc4fdf), captured, not written by hand
const REAL_PRO_PAGE = [
  '  - main [ref=e10]:',
  '    - generic [ref=e11]:',
  '      - heading "Pro" [level=1] [ref=e12]',
  '      - paragraph [ref=e13]: $20 a month',
  '      - region [ref=e14]:',
  '        - heading "Served from" [level=2] [ref=e15]',
  '        - list [ref=e16]:',
  '          - listitem [ref=e17]: US East (US)',
  '      - link "All plans" [ref=e18] [cursor=pointer]:',
  '        - /url: /plans',
].join('\n')

test("the real snapshot of Pro's page shows its regions exactly, by the same matcher", () => {
  expect(pageShowsServedFrom(parseAria(REAL_PRO_PAGE), 'Pro', ['US East (US)'])).toBe(true)
  expect(
    pageShowsServedFrom(parseAria(REAL_PRO_PAGE), 'Pro', ['US East (US)', 'EU West (EU)']),
  ).toBe(false)
})
