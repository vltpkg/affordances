import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { evaluate, type Context, type Truth, resolvePath } from '../src/evaluate.ts'
import { conformanceCases, falsifying, fitContext } from '../src/falsify.ts'
import type { CapabilityManifest, Expr } from '../src/schema.ts'

// three expressions whose value the context fixes: true, false, unknown
const T: Expr = { exists: 'target.yes' }
const F: Expr = { exists: 'target.no' }
const U: Expr = { exists: 'target.unsupplied' }
const base: Context = { target: { yes: 1, no: null } }
const truth = { [String(true)]: T, [String(false)]: F, unknown: U } as Record<string, Expr>
const values: Truth[] = [true, false, 'unknown']
const of = (v: Truth) => truth[String(v)]!

// the K3 tables, written out
const and = (a: Truth, b: Truth): Truth =>
  a === false || b === false ? false : a === true && b === true ? true : 'unknown'
const or = (a: Truth, b: Truth): Truth =>
  a === true || b === true ? true : a === false && b === false ? false : 'unknown'

describe("Kleene's strong three-valued logic (RFC 0001 §3.1)", () => {
  test('the three building blocks', () => {
    expect([evaluate(T, base), evaluate(F, base), evaluate(U, base)]).toEqual([
      true,
      false,
      'unknown',
    ])
  })
  test('not', () => {
    expect(values.map((v) => evaluate({ not: of(v) }, base))).toEqual([false, true, 'unknown'])
  })
  test.each(values.flatMap((a) => values.map((b) => [a, b] as const)))(
    'all and any of %s, %s',
    (a, b) => {
      expect(evaluate({ all: [of(a), of(b)] }, base)).toBe(and(a, b))
      expect(evaluate({ any: [of(a), of(b)] }, base)).toBe(or(a, b))
    },
  )
})

describe('missing against absent', () => {
  const c: Context = { target: { count: 2, note: null, meta: { a: 1 } }, input: { q: 3 } }
  const cases: [string, Expr, Context, Truth][] = [
    ['a root with no value is missing', { exists: 'principal.plan' }, c, 'unknown'],
    [
      "a declared attribute the application didn't supply is missing",
      { exists: 'target.status' },
      c,
      'unknown',
    ],
    ['an attribute supplied as null is absent', { exists: 'target.note' }, c, false],
    ['a key deeper in a supplied value is absent', { exists: 'target.meta.b' }, c, false],
    [
      'a key the input lacks is absent: the input is supplied whole',
      { exists: 'input.r' },
      c,
      false,
    ],
    ['no input yet is missing', { exists: 'input.q' }, { target: {} }, 'unknown'],
    [
      'a comparison with an absent operand is unknown',
      { gt: [{ path: 'target.note' }, { value: 0 }] },
      c,
      'unknown',
    ],
    [
      'a comparison with a missing operand is unknown',
      { gt: [{ path: 'target.status' }, { value: 0 }] },
      c,
      'unknown',
    ],
    [
      'a reference the context has',
      { exists: 'product.slug' },
      { references: { product: { slug: 'tee' } } },
      true,
    ],
    ['a reference it lacks is missing', { exists: 'product.slug' }, { references: {} }, 'unknown'],
  ]
  test.each(cases)('%s', (_, e, context, expected) => expect(evaluate(e, context)).toBe(expected))
})

describe('comparisons', () => {
  const c: Context = {
    target: { n: 2, s: 'm', b: true, list: ['a', 'b'], items: [{}, {}, {}] },
    input: {},
  }
  const cases: [string, Expr, Truth][] = [
    ['numbers order numerically', { lt: [{ path: 'target.n' }, { value: 10 }] }, true],
    ['strings by UTF-16 code units', { lt: [{ path: 'target.s' }, { value: 'n' }] }, true],
    ['ordering a boolean is unknown', { lt: [{ path: 'target.b' }, { value: true }] }, 'unknown'],
    [
      'a type mismatch is unknown, never false',
      { eq: [{ path: 'target.n' }, { value: '2' }] },
      'unknown',
    ],
    ['ne', { ne: [{ path: 'target.s' }, { value: 'x' }] }, true],
    ['in a literal list', { in: [{ path: 'target.s' }, { value: ['m', 'n'] }] }, true],
    ['in a path', { in: [{ value: 'a' }, { path: 'target.list' }] }, true],
    ['not in', { in: [{ value: 'z' }, { path: 'target.list' }] }, false],
    [
      'in something that is not an array is unknown',
      { in: [{ value: 'z' }, { path: 'target.s' }] },
      'unknown',
    ],
    ['count', { eq: [{ count: 'target.items' }, { value: 3 }] }, true],
    ['count of a non-array is unknown', { gt: [{ count: 'target.s' }, { value: 0 }] }, 'unknown'],
    ['two paths', { ge: [{ path: 'target.n' }, { count: 'target.list' }] }, true],
  ]
  test.each(cases)('%s', (_, e, expected) => expect(evaluate(e, c)).toBe(expected))
})

describe('quantifiers', () => {
  const c: Context = {
    target: {
      empty: [],
      regions: [
        { code: 'eu', zones: [{ up: true }, { up: true }] },
        { code: 'us', zones: [{ up: true }, { up: false }] },
      ],
      partial: [{ up: true }, { other: 1 }],
      text: 'x',
    },
  }
  const up: Expr = { eq: [{ path: 'item.up' }, { value: true }] }
  const cases: [string, Expr, Truth][] = [
    ['some over an empty array is false', { some: { of: 'target.empty', where: up } }, false],
    ['every over an empty array is true', { every: { of: 'target.empty', where: up } }, true],
    [
      'some, with an element unknown and none true',
      { some: { of: 'target.partial', where: { eq: [{ path: 'item.up' }, { value: false }] } } },
      'unknown',
    ],
    [
      'every, with an element unknown and none false',
      { every: { of: 'target.partial', where: up } },
      'unknown',
    ],
    ['an array that is missing', { some: { of: 'target.nothing', where: up } }, 'unknown'],
    ['something that is not an array', { some: { of: 'target.text', where: up } }, 'unknown'],
    // of resolves in the enclosing scope: item.zones is the outer element's
    [
      'nested: some region with every zone up',
      { some: { of: 'target.regions', where: { every: { of: 'item.zones', where: up } } } },
      true,
    ],
    [
      'nested: every region with every zone up',
      { every: { of: 'target.regions', where: { every: { of: 'item.zones', where: up } } } },
      false,
    ],
    [
      'a bare item is the element itself',
      { every: { of: 'input.qs', where: { le: [{ path: 'item' }, { value: 10 }] } } },
      'unknown',
    ],
  ]
  test.each(cases)('%s', (_, e, expected) => expect(evaluate(e, c)).toBe(expected))
  test('a bare item over scalars', () => {
    const e: Expr = { every: { of: 'input.qs', where: { le: [{ path: 'item' }, { value: 10 }] } } }
    expect([
      evaluate(e, { input: { qs: [1, 10] } }),
      evaluate(e, { input: { qs: [1, 11] } }),
    ]).toEqual([true, false])
  })
})

// rule 5's manifest half: for each declarative condition, the context that makes it false
const fixture = (file: string): CapabilityManifest =>
  JSON.parse(readFileSync(new URL(`../fixtures/valid/${file}`, import.meta.url), 'utf8'))
describe('falsifying', () => {
  test.each(readdirSync(new URL('../fixtures/valid', import.meta.url)))(
    'makes every declarative condition in %s false',
    (file) => {
      const m = fixture(file)
      for (const { capability, condition, context } of conformanceCases(m)) {
        const c = m.capabilities.find((x) => x.id === capability)!
        const expr = [...(c.preconditions ?? []), ...(c.authorization?.conditions ?? [])].find(
          (x) => x.id === condition,
        )!
        expect(context, `${capability} ${condition}`).toBeDefined()
        expect(
          evaluate((expr as { expr: Expr }).expr, context!),
          `${capability} ${condition}`,
        ).toBe(false)
      }
    },
  )

  const exprs: [string, Expr][] = [
    ['gt with a literal', { gt: [{ path: 'target.count' }, { value: 0 }] }],
    ['le with the literal on the left', { le: [{ value: 5 }, { path: 'input.q' }] }],
    ['eq on a string', { eq: [{ path: 'target.status' }, { value: 'open' }] }],
    ['eq on a boolean', { eq: [{ path: 'target.open' }, { value: true }] }],
    ['ne', { ne: [{ path: 'principal.plan' }, { path: 'target.slug' }] }],
    ['lt between two paths', { lt: [{ path: 'input.q' }, { path: 'target.stock' }] }],
    ['in a literal list', { in: [{ path: 'target.status' }, { value: ['open', 'held'] }] }],
    ['in a path', { in: [{ path: 'project.orgId' }, { path: 'principal.orgIds' }] }],
    ['a literal in a path', { in: [{ value: 'admin' }, { path: 'principal.roles' }] }],
    ['count', { gt: [{ count: 'target.items' }, { value: 0 }] }],
    ['count, ge', { ge: [{ count: 'target.items' }, { value: 3 }] }],
    ['exists', { exists: 'target.slug' }],
    ['not', { not: { exists: 'target.cancelled' } }],
    ['all', { all: [{ exists: 'target.a' }, { gt: [{ path: 'target.n' }, { value: 1 }] }] }],
    ['any', { any: [{ exists: 'target.a' }, { eq: [{ path: 'target.n' }, { value: 1 }] }] }],
    [
      'some',
      { some: { of: 'target.items', where: { gt: [{ path: 'item.stock' }, { value: 0 }] } } },
    ],
    [
      'every',
      {
        every: {
          of: 'target.items',
          where: { le: [{ path: 'item.quantity' }, { path: 'item.stock' }] },
        },
      },
    ],
    [
      'every over scalars',
      { every: { of: 'input.qs', where: { le: [{ path: 'item' }, { value: 10 }] } } },
    ],
    [
      'nested',
      {
        some: {
          of: 'target.regions',
          where: {
            every: { of: 'item.zones', where: { eq: [{ path: 'item.up' }, { value: true }] } },
          },
        },
      },
    ],
    ['not some', { not: { some: { of: 'target.items', where: { exists: 'item.sku' } } } }],
  ]
  test.each(exprs)('%s', (_, e) => {
    const context = falsifying(e)
    expect(context).toBeDefined()
    expect(evaluate(e, context!)).toBe(false)
  })

  test('says when nothing can make it false', () => {
    expect(
      falsifying({
        any: [
          { eq: [{ path: 'target.n' }, { value: 1 }] },
          { ne: [{ path: 'target.n' }, { value: 1 }] },
        ],
      }),
    ).toBeUndefined()
    expect(falsifying({ eq: [{ value: 1 }, { value: 1 }] })).toBeUndefined()
  })
})

describe('fail closed, never open (review of M2e)', () => {
  test.each([
    [
      'an inherited key is never supplied',
      { exists: 'target.constructor' } as Expr,
      { target: {} },
    ],
    ['nor toString', { exists: 'target.toString' } as Expr, { target: {} }],
    [
      'a reference named after an inherited key',
      { exists: 'constructor.name' } as Expr,
      { references: {} },
    ],
  ])('%s: unknown', (_, e, context) => expect(evaluate(e, context)).toBe('unknown'))

  test.each([
    ['le', { le: [{ path: 'input.q' }, { value: 5 }] } as Expr],
    ['ge', { ge: [{ path: 'input.q' }, { value: 5 }] } as Expr],
    ['eq', { eq: [{ path: 'input.q' }, { path: 'input.q' }] } as Expr],
    ['ne', { ne: [{ path: 'input.q' }, { value: 5 }] } as Expr],
    ['in', { in: [{ path: 'input.q' }, { value: [5] }] } as Expr],
  ])('NaN and Infinity order as nothing: %s is unknown', (_, e) => {
    expect(evaluate(e, { input: { q: Number.NaN } })).toBe('unknown')
    expect(evaluate(e, { input: { q: Number.POSITIVE_INFINITY } })).toBe('unknown')
  })
})

// a capability's declarative conditions, and a one-capability manifest to hold some
const declared = (m: CapabilityManifest, capability: string) => {
  const c = m.capabilities.find((x) => x.id === capability)!
  return [...(c.preconditions ?? []), ...(c.authorization?.conditions ?? [])].flatMap((x) =>
    'expr' in x ? [x] : [],
  )
}
const capability = (preconditions: { id: string; expr: Expr }[]): CapabilityManifest => ({
  schemaVersion: '0.1',
  namespace: 'urn:x',
  provenance: { source: 'o', basis: 'declared' },
  sources: [{ id: 'o', role: 'owner', name: 'o' }],
  resources: [],
  capabilities: [
    {
      id: 'a.b',
      kind: 'action',
      description: 'x',
      preconditions: preconditions.map((p) => ({ ...p, description: p.id })),
    },
  ],
})

describe('conformanceCases isolate the condition under test', () => {
  test.each(readdirSync(new URL('../fixtures/valid', import.meta.url)))(
    'in %s, each isolated case leaves exactly its condition false and the rest true',
    (file) => {
      const m = fixture(file)
      for (const c of conformanceCases(m).filter((x) => x.isolated)) {
        const seen = declared(m, c.capability).map((x) => [x.id, evaluate(x.expr, c.context!)])
        expect(seen, `${c.capability} ${c.condition}`).toEqual(
          declared(m, c.capability).map((x) => [x.id, x.id !== c.condition]),
        )
      }
    },
  )
  test("review's two conditions: each falsified alone, the other true", () => {
    const p1: Expr = { gt: [{ path: 'target.count' }, { value: 0 }] }
    const p2: Expr = { eq: [{ path: 'target.status' }, { value: 'open' }] }
    const cases = conformanceCases(
      capability([
        { id: 'p1', expr: p1 },
        { id: 'p2', expr: p2 },
      ]),
    )
    expect(
      cases.map((c) => [
        c.condition,
        c.isolated,
        evaluate(p1, c.context!),
        evaluate(p2, c.context!),
      ]),
    ).toEqual([
      ['p1', true, false, true],
      ['p2', true, true, false],
    ])
  })
  test('a condition that implies another can only be falsified with it: not isolated', () => {
    const [first] = conformanceCases(
      capability([
        { id: 'few', expr: { gt: [{ path: 'target.count' }, { value: 0 }] } },
        // whenever few is false, many is false too
        { id: 'many', expr: { gt: [{ path: 'target.count' }, { value: -5 }] } },
      ]),
    ).filter((c) => c.condition === 'many')
    expect(first!.isolated).toBe(false)
    expect(evaluate({ gt: [{ path: 'target.count' }, { value: -5 }] }, first!.context!)).toBe(false)
  })
})

test('a count’s witness elements take the type its schema declares, so the state fits the resource (code review 7)', () => {
  const m = fixture('plans.json')
  // hasDomain counts project.domains, which are strings: every case that needs a domain gets string ones
  const withDomains = conformanceCases(m).filter(
    (k) => (k.context?.references?.project?.domains as unknown[] | undefined)?.length,
  )
  expect(withDomains.length).toBeGreaterThan(0)
  for (const k of withDomains)
    expect(
      (k.context!.references!.project!.domains as unknown[]).every((d) => typeof d === 'string'),
    ).toBe(true)
  // and fitContext on its own: an empty placeholder becomes the item type's value
  const c = m.capabilities.find((x) => x.id === 'hosting.plan.subscribe')!
  expect(fitContext(m, c, { references: { project: { domains: [{}, {}] } } })).toEqual({
    references: { project: { domains: ['', ''] } },
  })
})

test('fitContext fills an object placeholder’s required properties, and takes an enum’s or a const’s value', () => {
  const m = fixture('plans.json')
  const c = m.capabilities.find((x) => x.id === 'hosting.plan.subscribe')!
  const project = m.resources.find((r) => r.id === 'hosting.project')!
  project.attributes = {
    type: 'object',
    properties: {
      zones: {
        type: 'array',
        items: {
          type: 'object',
          required: ['code', 'tier'],
          properties: { code: { type: 'string' }, tier: { enum: ['gold', 'silver'] } },
        },
      },
      kinds: { type: 'array', items: { enum: ['a', 'b'] } },
      fixed: { type: 'array', items: { const: 7 } },
    },
  }
  expect(
    fitContext(m, c, { references: { project: { zones: [{}], kinds: [{}], fixed: [{}] } } }),
  ).toEqual({
    references: { project: { zones: [{ code: '', tier: 'gold' }], kinds: ['a'], fixed: [7] } },
  })
})

// review's boundary #1 (2026-11-18): an input known only in part, as a projection knows it before the agent gives
// any. A top-level key it doesn't hold is missing, so exists and its negation are unknown; a key inside a supplied
// value is still absent, since that value is supplied whole
test('a partial input: an ungiven top-level key is missing, a key inside a supplied value is absent', () => {
  const partial = {
    input: { addOns: ['support'], plan: { tier: 'pro' } },
    partialInput: true as const,
  }
  expect(resolvePath('input.coupon', partial)).toEqual({ kind: 'missing' })
  expect(resolvePath('input.plan.seats', partial)).toEqual({ kind: 'absent' })
  expect(resolvePath('input.addOns', partial)).toEqual({ kind: 'value', value: ['support'] })
  expect(evaluate({ exists: 'input.coupon' }, partial)).toBe('unknown')
  expect(evaluate({ not: { exists: 'input.coupon' } }, partial)).toBe('unknown')
  // a whole input, as execution has it: the same key is absent
  const whole = { input: { addOns: ['support'] } }
  expect(resolvePath('input.coupon', whole)).toEqual({ kind: 'absent' })
  expect(evaluate({ exists: 'input.coupon' }, whole)).toBe(false)
})
