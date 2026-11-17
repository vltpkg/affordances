import { expect, test } from 'vitest'
import { evaluate, type Context, type Expr } from '../src/index.ts'
import { falsifying, searchFalsifying } from '../src/falsify.ts'

// review's oracle (close-out finding): random expressions over strings, numbers, count, exists, in, some and every,
// nested all, any and not, checked by brute force over every state of a small domain (review's, with null added). A complete falsifier finds a
// state whenever one of these exists, and every state it finds is false
const ATOMS: Expr[] = [
  { eq: [{ path: 'target.s' }, { value: 'x' }] },
  { eq: [{ path: 'target.s' }, { value: 'y' }] },
  { ne: [{ path: 'target.s' }, { value: 'x' }] },
  { in: [{ path: 'target.s' }, { value: ['x', 'z'] }] },
  { exists: 'target.s' },
  { gt: [{ path: 'target.n' }, { value: 0 }] },
  { eq: [{ path: 'target.n' }, { value: 3 }] },
  { le: [{ path: 'target.n' }, { value: 1 }] },
  { gt: [{ count: 'target.items' }, { value: 0 }] },
  { eq: [{ count: 'target.items' }, { value: 2 }] },
  { some: { of: 'target.items', where: { eq: [{ path: 'item.k' }, { value: 'a' }] } } },
  { every: { of: 'target.items', where: { eq: [{ path: 'item.k' }, { value: 'a' }] } } },
]
// null too: exists is false only on a value supplied as null, since a missing one is unknown. And a fresh string
// and in-between numbers, which the falsifier's own pool has, so the oracle can't miss what it finds
const S = [undefined, null, 'x', 'y', 'z', 'w']
const N = [undefined, null, -1, 0, 1, 2, 3, 5]
// every list of up to two items, each with k 'a', k 'b', or no k
const ITEMS = [{ k: 'a' }, { k: 'b' }, {}]
const I: unknown[] = [
  undefined,
  null,
  [],
  ...ITEMS.map((a) => [a]),
  ...ITEMS.flatMap((a) => ITEMS.map((b) => [a, b])),
]
const states: Context[] = []
for (const s of S)
  for (const n of N)
    for (const items of I) {
      const t: Record<string, unknown> = {}
      if (s !== undefined) t.s = s
      if (n !== undefined) t.n = n
      if (items !== undefined) t.items = items
      states.push({ target: t })
    }

const generator = (start: number) => {
  let seed = start
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const expr = (d = 0): Expr => {
    const r = rnd()
    if (d < 2 && r < 0.22) return { all: [expr(d + 1), expr(d + 1)] }
    if (d < 2 && r < 0.4) return { any: [expr(d + 1), expr(d + 1)] }
    if (d < 2 && r < 0.5) return { not: expr(d + 1) }
    return structuredClone(ATOMS[Math.floor(rnd() * ATOMS.length)]!)
  }
  return expr
}

test('the falsifier is complete on review’s oracle set: 3,000 expressions, no miss and no wrong witness', () => {
  const expr = generator(5)
  const misses: string[] = []
  const wrong: string[] = []
  const gaveUp: string[] = []
  for (let i = 0; i < 3000; i++) {
    const e = expr()
    const falsifiable = states.some((s) => evaluate(e, s) === false)
    const searched = searchFalsifying(e)
    if ('gaveUp' in searched) gaveUp.push(JSON.stringify(e))
    if ('none' in searched && falsifiable) misses.push(JSON.stringify(e))
    if ('context' in searched && evaluate(e, searched.context) !== false)
      wrong.push(JSON.stringify(e))
    // and falsifying, the witness first and the search behind it, agrees
    const w = falsifying(e)
    if (!w && falsifiable) misses.push(`falsifying: ${JSON.stringify(e)}`)
    if (w && evaluate(e, w) !== false) wrong.push(`falsifying: ${JSON.stringify(e)}`)
  }
  expect({ misses, wrong, gaveUp }).toEqual({ misses: [], wrong: [], gaveUp: [] })
}, 120_000)

test('review’s example, any[in(s, [x, z]), eq(s, x)], is falsified', () => {
  const e: Expr = {
    any: [
      { in: [{ path: 'target.s' }, { value: ['x', 'z'] }] },
      { eq: [{ path: 'target.s' }, { value: 'x' }] },
    ],
  }
  const w = falsifying(e)
  expect(w && evaluate(e, w)).toBe(false)
})

test('implication, as the kit reads it, agrees with brute force on 3,000 random pairs', () => {
  const expr = generator(11)
  const wrong: string[] = []
  let implied = 0
  for (let i = 0; i < 3000; i++) {
    const [p, q] = [expr(), expr()]
    const counter = states.some((s) => evaluate(p, s) === false && evaluate(q, s) === true)
    // the kit: p implies q's falsity when no state makes p false and q true
    const proved = 'none' in searchFalsifying({ any: [p, { not: q }] })
    if (proved) implied++
    if (proved === counter) wrong.push(JSON.stringify([p, q]))
  }
  expect(wrong).toEqual([])
  expect(implied).toBeGreaterThan(0)
}, 120_000)

// review's realistic pairs, each with a counterexample: p false and q true at once
test.for([
  [
    'not in [pro, team], then not pro',
    { not: { in: [{ path: 'target.slug' }, { value: ['pro', 'team'] }] } },
    { not: { eq: [{ path: 'target.slug' }, { value: 'pro' }] } },
  ],
  [
    'no seats, then 5 seats or fewer',
    { eq: [{ count: 'input.seats' }, { value: 0 }] },
    { le: [{ count: 'input.seats' }, { value: 5 }] },
  ],
  [
    'not every zone up, then none up',
    {
      not: { every: { of: 'target.zones', where: { eq: [{ path: 'item.up' }, { value: true }] } } },
    },
    {
      not: { some: { of: 'target.zones', where: { eq: [{ path: 'item.up' }, { value: true }] } } },
    },
  ],
] as [string, Expr, Expr][])('%s: not implied, and the counterexample is found', ([, p, q]) => {
  const found = searchFalsifying({ any: [p, { not: q }] })
  expect('context' in found).toBe(true)
  const context = (found as { context: Context }).context
  expect([evaluate(p, context), evaluate(q, context)]).toEqual([false, true])
})
