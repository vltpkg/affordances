import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { compose } from '../src/compose.ts'
import { evaluate } from '../src/evaluate.ts'
import { conformanceCases } from '../src/falsify.ts'
import { jsonSchema } from '../src/json-schema.ts'
import { normalize } from '../src/normalize.ts'
import type { CapabilityManifest, Provenance } from '../src/schema.ts'
import { validate } from '../src/validate.ts'

// RFC 0001 §8.2: one test per rule, on what a manifest can show. The runtime half of rules 1, 2 and 5 is M3's
const fixture = (file: string): CapabilityManifest =>
  JSON.parse(readFileSync(new URL(`../fixtures/valid/${file}`, import.meta.url), 'utf8'))
const files = readdirSync(new URL('../fixtures/valid', import.meta.url))
// untyped, so a test can write what the types forbid
const plans = () =>
  JSON.parse(readFileSync(new URL('../fixtures/valid/plans.json', import.meta.url), 'utf8'))
const codes = (m: unknown) => validate(m).issues.map((i) => i.code)
const defs = (jsonSchema() as { $defs: Record<string, { properties?: Record<string, unknown> }> })
  .$defs

const list = (x: CapabilityManifest) => x.capabilities.find((c) => c.id === 'hosting.plan.list')!
// every definition's, relation's and claim's basis, as it resolves against its default
const bases = (m: CapabilityManifest) =>
  Object.fromEntries([
    ...[...m.resources, ...m.capabilities].map((d) => [d.id, (d.provenance ?? m.provenance).basis]),
    ...(m.claims ?? []).map((c) => [`claim ${c.id}`, c.provenance.basis]),
    ...(m.relations ?? []).map((r) => [
      `${r.type} ${r.from} ${r.to}`,
      (r.provenance ?? m.provenance).basis,
    ]),
  ])

describe('rule 1: an offer is never authorization', () => {
  test('authorization can only require something of a principal: any, or authenticated', () => {
    expect(Object.keys(defs.AuthorizationRequirement!.properties!).toSorted()).toEqual([
      'conditions',
      'principal',
    ])
    const m = plans()
    m.capabilities[1].authorization = { principal: 'none' }
    expect(codes(m)).toContain('E_SCHEMA')
  })
  test('nothing can say "pre-authorized" or "skip checks": unknown fields are schema errors', () => {
    for (const change of [
      (m: ReturnType<typeof plans>) => (m.capabilities[1].authorization.skipChecks = true),
      (m: ReturnType<typeof plans>) => (m.capabilities[1].trusted = true),
      (m: ReturnType<typeof plans>) => (m.preauthorized = true),
    ]) {
      const m = plans()
      change(m)
      expect(codes(m)).toContain('E_SCHEMA')
    }
  })
})

describe('rule 2: an annotation never makes an operation safe, or removes a confirmation', () => {
  test.each([
    '/confirmation/summary',
    '/kind',
    '/safe',
    '/idempotent',
    '/authorization',
    '/effects/0',
    '/preconditions',
  ])('a claim about %s is E_ENFORCEMENT_CLAIM', (about) => {
    const m = plans()
    m.claims[0].about = about
    expect(codes(m)).toContain('E_ENFORCEMENT_CLAIM')
  })
  test('confirmation has no "not required"', () => {
    const m = plans()
    m.capabilities[1].confirmation = { summary: 'x', required: false }
    expect(codes(m)).toContain('E_SCHEMA')
  })
  test('safe: true and effects: [] keep a confirmation through normalize and compose', () => {
    const m = plans()
    m.capabilities[0].confirmation = { summary: 'List every plan' }
    expect(list(normalize(m)).confirmation).toEqual({ summary: 'List every plan' })
    const composed = compose([m, m])
    expect(composed.ok && list(composed.manifest).confirmation).toEqual({
      summary: 'List every plan',
    })
  })
})

describe('rule 3: inferred semantics never become declared or verified without a source', () => {
  const cases: [string, Provenance, string][] = [
    ['declared by a tool', { source: 'compiler', basis: 'declared' }, 'E_BASIS'],
    ['inferred by the owner', { source: 'host', basis: 'inferred' }, 'E_BASIS'],
    [
      'verified by the owner',
      { source: 'host', basis: 'verified', evidence: [{ description: 'x' }] },
      'E_BASIS',
    ],
    ['verified without evidence', { source: 'monitor', basis: 'verified' }, 'E_BASIS'],
  ]
  test.each(cases)('%s is refused', (_, provenance, code) => {
    const m = plans()
    m.sources.push({ id: 'compiler', role: 'tool', name: 'A compiler' })
    m.capabilities[1].provenance = provenance
    expect(codes(m)).toContain(code)
  })

  test.each(files)('normalize and compose never change a basis, in %s', (file) => {
    const m = fixture(file)
    expect(bases(normalize(m))).toEqual(bases(m))
    const composed = compose([m, m])
    expect(composed.ok && bases(composed.manifest)).toEqual(bases(m))
  })
})

describe('rule 4: no unexplained confidence numbers', () => {
  // every number the IR's own schema allows, by where it is; embedded JSON Schemas and extensions are opaque
  const numbers: string[] = []
  const walk = (node: unknown, at: string) => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (n.type === 'number' || n.type === 'integer') numbers.push(at)
    for (const [k, v] of Object.entries(n)) walk(v, `${at}/${k}`)
  }
  walk(defs, '')
  test('the only numbers in the schema are a claim quantity’s value and a charge’s amount, each with its unit', () => {
    expect(
      numbers.filter((at) => !at.includes('/Scalar') && !at.includes('/Operand')).toSorted(),
    ).toEqual(['/Amount/properties/value/anyOf/1', '/Claim/properties/quantity/properties/value'])
    expect(defs.Claim!.properties!.quantity).toMatchObject({ required: ['value', 'unit'] })
    // a charge's amount carries its currency, always (intake, 2026-11-18)
    expect(defs.Amount).toMatchObject({ required: ['value', 'currency'] })
  })
  test('a confidence or score field is a schema error', () => {
    for (const field of ['confidence', 'score', 'trust']) {
      const m = plans()
      m.claims[0][field] = 0.8
      expect(codes(m)).toContain('E_SCHEMA')
    }
  })
})

describe("rule 5: every declared precondition is enforced (the manifest's half)", () => {
  test.each(files)(
    'every declarative condition in %s has a context that makes it false',
    (file) => {
      const m = fixture(file)
      for (const c of conformanceCases(m)) {
        const capability = m.capabilities.find((x) => x.id === c.capability)!
        const condition = [
          ...(capability.preconditions ?? []),
          ...(capability.authorization?.conditions ?? []),
        ].find((x) => x.id === c.condition) as { expr: Parameters<typeof evaluate>[0] }
        expect(evaluate(condition.expr, c.context!)).toBe(false)
      }
    },
  )
  test('a guard is not a declarative case: the kit forces its handler instead (RFC 0002)', () => {
    const cases = conformanceCases(plans()).map((c) => c.condition)
    expect(cases).not.toContain('billing')
    expect(cases).toEqual(
      expect.arrayContaining(['member', 'notCurrent', 'hasDomain', 'regionUp', 'seatsInRange']),
    )
  })
})

// boundary review #3 (2026-11-18): fitting a case to the declared schemas mapped every wrongly typed fresh value to one
// constant, so two paths the search told apart came out equal, and the case no longer falsified its condition
// one capability whose only precondition compares two number attributes with each other, with no literal to type
// the search's values, so its fresh values are strings and fitting has to make them numbers
const compared = (op: 'eq' | 'ne' | 'lt') => {
  const m = plans()
  m.resources.find((r: { id: string }) => r.id === 'hosting.plan').attributes.properties.limit = {
    type: 'number',
  }
  const c = m.capabilities.find((x: { id: string }) => x.id === 'hosting.plan.subscribe')
  c.preconditions = [
    {
      id: 'compared',
      description: 'Compared',
      expr: { [op]: [{ path: 'target.priceUsd' }, { path: 'target.limit' }] },
    },
  ]
  c.authorization = { ...c.authorization, conditions: [] }
  return m as CapabilityManifest
}

describe('fitting a case keeps it falsifying', () => {
  test.each(['eq', 'ne', 'lt'] as const)(
    '%s between two number attributes: the fitted context still makes it false',
    (op) => {
      const m = compared(op)
      const [k] = conformanceCases(m).filter((x) => x.condition === 'compared')
      const target = k!.context!.target!
      expect([typeof target.priceUsd, typeof target.limit]).toEqual(['number', 'number'])
      expect(
        evaluate(
          { [op]: [{ path: 'target.priceUsd' }, { path: 'target.limit' }] } as never,
          k!.context!,
        ),
      ).toBe(false)
    },
  )
  test('a case fitting can’t keep false is failed with a reason, never run as if it were', () => {
    // n is declared a string but compared with a number: the search falsifies eq with another number, and fitting n to
    // a string leaves a comparison that's unknown, not false
    const m = plans()
    m.resources.find((r: { id: string }) => r.id === 'hosting.plan').attributes.properties = {
      n: { type: 'string' },
    }
    const s = m.capabilities.find((x: { id: string }) => x.id === 'hosting.plan.subscribe')
    s.preconditions = [
      { id: 'five', description: 'Five', expr: { eq: [{ path: 'target.n' }, { value: 5 }] } },
    ]
    s.authorization = { ...s.authorization, conditions: [] }
    const [k] = conformanceCases(m as CapabilityManifest)
    expect(k!.reason).toMatch(
      /fitting the falsifying state to the declared schemas makes five hold again/,
    )
  })
})
