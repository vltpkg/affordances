import { expect, test } from 'vitest'
import { holdsPhrase, parseAria, showsFact, showsInTree } from '../src/facts.ts'

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
