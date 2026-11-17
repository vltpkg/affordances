import { expect, test } from 'vitest'
import { evaluate, searchFalsifying, type Context, type Expr } from '../src/index.ts'

// review's none oracle (review of the kit rework): a none is a proof, so every none from a harder generator (depth 4,
// path-to-path comparisons, principal paths, a where over two fields of one item) is brute-forced over 51,520 states
const ATOMS: Expr[] = [
  { eq: [{ path: 'target.s' }, { value: 'x' }] },
  { ne: [{ path: 'target.s' }, { value: 'y' }] },
  { in: [{ path: 'target.s' }, { value: ['x', 'z'] }] },
  { exists: 'target.s' },
  { gt: [{ path: 'target.n' }, { value: 0 }] },
  { le: [{ path: 'target.n' }, { value: 3 }] },
  { eq: [{ path: 'target.n' }, { value: 2 }] },
  { eq: [{ path: 'principal.plan' }, { path: 'target.s' }] },
  { ne: [{ path: 'principal.plan' }, { path: 'target.s' }] },
  { gt: [{ path: 'target.n' }, { path: 'principal.limit' }] },
  { eq: [{ path: 'principal.plan' }, { value: 'x' }] },
  { gt: [{ count: 'target.items' }, { value: 1 }] },
  { eq: [{ count: 'target.items' }, { value: 0 }] },
  { some: { of: 'target.items', where: { eq: [{ path: 'item.k' }, { value: 'a' }] } } },
  { every: { of: 'target.items', where: { gt: [{ path: 'item.w' }, { value: 1 }] } } },
  {
    some: {
      of: 'target.items',
      where: { all: [{ eq: [{ path: 'item.k' }, { path: 'target.s' }] }, { exists: 'item.w' }] },
    },
  },
]

const items: Record<string, unknown>[] = []
for (const k of [undefined, 'a', 'x'])
  for (const w of [undefined, 0, 2]) {
    const item: Record<string, unknown> = {}
    if (k !== undefined) item.k = k
    if (w !== undefined) item.w = w
    items.push(item)
  }
const lists: unknown[] = [
  undefined,
  [],
  ...items.flatMap((a) => [[a], ...items.map((b) => [a, b])]),
]
const states: Context[] = []
for (const s of [undefined, null, 'x', 'y', 'z'])
  for (const n of [undefined, null, 0, 1, 2, 3, 4])
    for (const plan of [undefined, 'x', 'y', 'z'])
      for (const limit of [undefined, 0, 1, 3])
        for (const list of lists) {
          const target: Record<string, unknown> = {}
          const principal: Record<string, unknown> = {}
          if (s !== undefined) target.s = s
          if (n !== undefined) target.n = n
          if (list !== undefined) target.items = list
          if (plan !== undefined) principal.plan = plan
          if (limit !== undefined) principal.limit = limit
          states.push({ target, principal } as Context)
        }

const generator = (start: number, depth: number) => {
  let seed = start
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const expr = (d = 0): Expr => {
    const r = rnd()
    if (d < depth && r < 0.25)
      return { all: [expr(d + 1), expr(d + 1), ...(rnd() < 0.3 ? [expr(d + 1)] : [])] }
    if (d < depth && r < 0.45) return { any: [expr(d + 1), expr(d + 1)] }
    if (d < depth && r < 0.55) return { not: expr(d + 1) }
    return structuredClone(ATOMS[Math.floor(rnd() * ATOMS.length)]!)
  }
  return expr
}

test.for([
  [3, 3],
  [3, 4],
  [5, 4],
] as [number, number][])(
  'seed %i, depth %i: every none has no counterexample, and every witness is false',
  { timeout: 300_000 },
  ([seed, depth]) => {
    const expr = generator(seed, depth)
    let nones = 0
    const refuted: string[] = []
    const wrong: string[] = []
    for (let i = 0; i < 2000; i++) {
      const e = expr()
      const found = searchFalsifying(e)
      if ('context' in found && evaluate(e, found.context) !== false) wrong.push(JSON.stringify(e))
      if (!('none' in found)) continue
      nones++
      if (states.some((s) => evaluate(e, s) === false)) refuted.push(JSON.stringify(e))
    }
    expect({ refuted, wrong }).toEqual({ refuted: [], wrong: [] })
    expect(nones).toBeGreaterThan(20)
  },
)

// review's minimal cases: a where needing two fields of one item, and an item field against an outer path
test.for([
  [
    'eq(item.k, x) and exists item.w',
    { all: [{ eq: [{ path: 'item.k' }, { value: 'x' }] }, { exists: 'item.w' }] },
  ],
  [
    'eq(item.k, x) and item.w > 1',
    {
      all: [
        { eq: [{ path: 'item.k' }, { value: 'x' }] },
        { gt: [{ path: 'item.w' }, { value: 1 }] },
      ],
    },
  ],
  [
    'eq(item.k, target.s) and exists item.w',
    { all: [{ eq: [{ path: 'item.k' }, { path: 'target.s' }] }, { exists: 'item.w' }] },
  ],
] as [string, Expr][])('not some(items where %s) is falsified', ([, where]) => {
  const e: Expr = { not: { some: { of: 'target.items', where } } }
  const found = searchFalsifying(e)
  expect('context' in found && evaluate(e, found.context)).toBe(false)
})

test('an item field compared with an outer path takes that path’s literals: target.s in [x, z]', () => {
  const e: Expr = {
    not: {
      all: [
        {
          some: {
            of: 'target.items',
            where: {
              all: [{ eq: [{ path: 'item.k' }, { path: 'target.s' }] }, { exists: 'item.w' }],
            },
          },
        },
        { in: [{ path: 'target.s' }, { value: ['x', 'z'] }] },
      ],
    },
  }
  const found = searchFalsifying(e)
  expect('context' in found && evaluate(e, found.context)).toBe(false)
})
