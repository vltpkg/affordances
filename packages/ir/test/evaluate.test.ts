import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { evaluate, type Context, type Truth } from '../src/evaluate.ts'
import { conformanceCases, falsifying } from '../src/falsify.ts'
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
