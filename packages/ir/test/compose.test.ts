import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { canonicalJson } from '../src/canonical.ts'
import { compose } from '../src/compose.ts'
import { derive, satisfies } from '../src/derive.ts'
import { normalize } from '../src/normalize.ts'
import type { CapabilityManifest, Expr } from '../src/schema.ts'
import { validate } from '../src/validate.ts'

const fixture = (file: string): CapabilityManifest =>
  JSON.parse(readFileSync(new URL(`../fixtures/valid/${file}`, import.meta.url), 'utf8'))
const files = readdirSync(new URL('../fixtures/valid', import.meta.url))
const bytes = (m: CapabilityManifest) => canonicalJson(normalize(m))
const composed = (fragments: CapabilityManifest[]) => {
  const result = compose(fragments)
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return canonicalJson(result.manifest)
}

// a seeded generator, so a failure reproduces
const random = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed / 2 ** 31
}
// splits a manifest into n fragments of one namespace: every definition, claim, relation and binding lands in one
// of them, at random. Every fragment keeps the sources, the default provenance and (on some) the principal
const split = (m: CapabilityManifest, n: number, next: () => number): CapabilityManifest[] => {
  const pick = <T>(items: T[] | undefined) => {
    const out = Array.from({ length: n }, () => [] as T[])
    for (const item of items ?? []) out[Math.floor(next() * n)]!.push(item)
    return out
  }
  const [res, caps, rels, claims, binds] = [
    pick(m.resources),
    pick(m.capabilities),
    pick(m.relations),
    pick(m.claims),
    pick(m.bindings),
  ]
  return Array.from({ length: n }, (_, i) => ({
    schemaVersion: m.schemaVersion,
    namespace: m.namespace,
    ...(m.title !== undefined && { title: m.title }),
    provenance: m.provenance,
    ...(m.principal && next() < 0.5 && { principal: m.principal }),
    sources: m.sources,
    resources: res[i]!,
    capabilities: caps[i]!,
    relations: rels[i]!,
    claims: claims[i]!,
    bindings: binds[i]!,
    ...(m.extensions && { extensions: m.extensions }),
  }))
}
const shuffled = <T>(items: T[], next: () => number) =>
  items
    .map((item) => [next(), item] as const)
    .toSorted(([a], [b]) => a - b)
    .map(([, item]) => item)

describe('compose', () => {
  test.each(files)('of %s with itself is the manifest, normalized (idempotent)', (file) => {
    const m = fixture(file)
    expect(composed([m])).toBe(bytes(m))
    expect(composed([m, m, m])).toBe(bytes(m))
  })

  test.each(files)('of %s, split at random, is the whole in any order and grouping', (file) => {
    const m = fixture(file)
    // the principal must reach the result even when only some fragments carry it
    for (let seed = 1; seed <= 40; seed++) {
      const next = random(seed)
      const parts = split(m, 2 + (seed % 4), next)
      if (m.principal && !parts.some((p) => p.principal))
        parts[0] = { ...parts[0]!, principal: m.principal }
      const whole = bytes(m)
      // commutative: any order
      expect(composed(shuffled(parts, next))).toBe(whole)
      // associative: ((a b) c …) against (a (b c …))
      const [a, ...rest] = parts
      const left = compose([a!, rest[0]!])
      const right = compose(rest)
      if (!left.ok || !right.ok) throw new Error('a split conflicted')
      expect(composed([left.manifest, ...rest.slice(1)])).toBe(whole)
      expect(composed([a!, right.manifest])).toBe(whole)
    }
  })

  test("keeps each fragment's own default when the defaults differ", () => {
    const m = fixture('plans.json')
    const tool = { id: 'compiler', role: 'tool' as const, name: 'A compiler' }
    const inferred = { source: 'compiler', basis: 'inferred' as const }
    const a = { ...m, sources: [...m.sources, tool], capabilities: m.capabilities.slice(0, 2) }
    const b = {
      ...m,
      sources: [...m.sources, tool],
      provenance: inferred,
      resources: [],
      capabilities: m.capabilities.slice(2),
      claims: [],
      relations: [],
      bindings: [],
    }
    const one = compose([a, b])
    const other = compose([b, a])
    if (!one.ok || !other.ok) throw new Error('conflict')
    expect(canonicalJson(one.manifest)).toBe(canonicalJson(other.manifest))
    // what came from b still says it was inferred; what came from a, declared
    const provenanceOf = (id: string) =>
      one.manifest.capabilities.find((c) => c.id === id)!.provenance ?? one.manifest.provenance
    expect(provenanceOf('hosting.plan.cancel')).toEqual(inferred)
    expect(provenanceOf('hosting.plan.list')).toEqual(m.provenance)
    expect(validate(one.manifest).ok).toBe(true)
  })

  test('the same definition from two fragments that attribute it differently is E_CONFLICT (rule 3)', () => {
    const m = fixture('plans.json')
    const tool = { id: 'compiler', role: 'tool' as const, name: 'A compiler' }
    const b = {
      ...m,
      sources: [...m.sources, tool],
      provenance: { source: 'compiler', basis: 'inferred' as const },
    }
    const result = compose([{ ...m, sources: [...m.sources, tool] }, b])
    expect(result.issues.map((i) => i.code)).toContain('E_CONFLICT')
  })

  const conflicts: [string, (m: CapabilityManifest) => CapabilityManifest, string][] = [
    [
      'two definitions with one id',
      (m) => ({ ...m, capabilities: [{ ...m.capabilities[0]!, description: 'other' }] }),
      '/capabilities',
    ],
    [
      'two sources with one id',
      (m) => ({ ...m, sources: [{ ...m.sources[0]!, name: 'other' }] }),
      '/sources',
    ],
    [
      'two claims with one id',
      (m) => ({ ...m, claims: [{ ...m.claims![0]!, statement: 'other' }] }),
      '/claims',
    ],
    [
      'two principals',
      (m) => ({ ...m, principal: { attributes: { type: 'object' } } }),
      '/principal',
    ],
    ['two namespaces', (m) => ({ ...m, namespace: 'https://other.example/c' }), '/namespace'],
    [
      'two values for one extension',
      (m) => ({ ...m, extensions: { 'https://hosting.example/ext/region': { default: 'us' } } }),
      '/extensions',
    ],
    ['two titles', (m) => ({ ...m, title: 'Another' }), '/title'],
  ]
  test.each(conflicts)('%s is E_CONFLICT, never an override', (_, change, at) => {
    const m = fixture('plans.json')
    const result = compose([m, change(m)])
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => `${i.code} ${i.at}`)).toContain(`E_CONFLICT ${at}`)
    // and the other way round
    expect(compose([change(m), m]).ok).toBe(false)
  })

  test('equal definitions written differently collapse', () => {
    const m = fixture('plans.json')
    const reordered = { ...m, capabilities: m.capabilities.toReversed() }
    expect(composed([m, reordered])).toBe(bytes(m))
  })
})

describe('derive', () => {
  test("gives RFC 0001 §11's edges, each with what it came from", () => {
    expect(derive(normalize(fixture('rfc-0001-example.json')))).toEqual([
      {
        relation: 'enables',
        from: 'commerce.cart.addItem',
        to: 'commerce.cart.checkout',
        basis: 'inferred',
        via: ['/capabilities/0/effects/0', '/capabilities/1/preconditions/1'],
      },
      {
        relation: 'enables',
        from: 'commerce.cart.checkout',
        to: 'commerce.order.refund',
        basis: 'inferred',
        via: ['/capabilities/1/effects/1', '/capabilities/2/target'],
      },
      {
        relation: 'prerequisite',
        from: 'commerce.cart.addItem',
        to: 'commerce.cart.checkout',
        basis: 'inferred',
        via: ['/capabilities/0/effects/0', '/capabilities/1/preconditions/1'],
      },
      {
        relation: 'produces',
        from: 'commerce.cart.checkout',
        to: 'commerce.order',
        basis: 'inferred',
        via: ['/capabilities/1/effects/1'],
      },
      {
        relation: 'supports',
        from: 'commerce.cart',
        to: 'commerce.cart.addItem',
        basis: 'inferred',
        via: ['/capabilities/0/target'],
      },
      {
        relation: 'supports',
        from: 'commerce.cart',
        to: 'commerce.cart.checkout',
        basis: 'inferred',
        via: ['/capabilities/1/target'],
      },
      {
        relation: 'supports',
        from: 'commerce.order',
        to: 'commerce.order.refund',
        basis: 'inferred',
        via: ['/capabilities/2/target'],
      },
      {
        relation: 'supports',
        from: 'commerce.product',
        to: 'commerce.cart.addItem',
        basis: 'inferred',
        via: ['/capabilities/0/references/0/resource'],
      },
    ])
  })

  test('a second capability establishing the same thing makes it an enabler, not a prerequisite', () => {
    const m = normalize(fixture('rfc-0001-example.json'))
    const restock = { ...m.capabilities[0]!, id: 'commerce.cart.restore', references: undefined }
    const edges = derive(normalize({ ...m, capabilities: [...m.capabilities, restock] }))
    expect(edges.filter((e) => e.relation === 'prerequisite')).toEqual([])
    expect(
      edges
        .filter((e) => e.relation === 'enables' && e.to === 'commerce.cart.checkout')
        .map((e) => e.from),
    ).toEqual(['commerce.cart.addItem', 'commerce.cart.restore'])
  })

  const gt0: Expr = { gt: [{ path: 'target.count' }, { value: 0 }] }
  const cases: [string, Expr, Expr, boolean][] = [
    ['identical atoms', gt0, gt0, true],
    ['an eq that makes it true', { eq: [{ path: 'target.count' }, { value: 3 }] }, gt0, true],
    ['an eq that makes it false', { eq: [{ path: 'target.count' }, { value: 0 }] }, gt0, false],
    ['an eq on another path', { eq: [{ path: 'target.total' }, { value: 3 }] }, gt0, false],
    [
      'an eq with the value on the left',
      { eq: [{ value: 'paid' }, { path: 'target.status' }] },
      { eq: [{ path: 'target.status' }, { value: 'paid' }] },
      true,
    ],
    [
      'an eq for an in',
      { eq: [{ path: 'target.status' }, { value: 'paid' }] },
      { in: [{ path: 'target.status' }, { value: ['paid', 'sent'] }] },
      true,
    ],
    [
      'an eq for exists',
      { eq: [{ path: 'target.status' }, { value: 'paid' }] },
      { exists: 'target.status' },
      true,
    ],
    [
      'every atom of an all',
      { all: [gt0, { eq: [{ path: 'target.open' }, { value: true }] }] },
      { all: [{ eq: [{ path: 'target.open' }, { value: true }] }, gt0] },
      true,
    ],
    ['only some atoms of an all', gt0, { all: [gt0, { exists: 'target.status' }] }, false],
    [
      'a count',
      { eq: [{ count: 'target.items' }, { value: 2 }] },
      { gt: [{ count: 'target.items' }, { value: 0 }] },
      true,
    ],
    ['an any is never an atom', gt0, { any: [gt0] }, false],
    ['a not is never an atom', { not: gt0 }, { not: gt0 }, false],
    [
      'a quantifier is never an atom',
      { some: { of: 'target.items', where: { exists: 'item.sku' } } },
      { some: { of: 'target.items', where: { exists: 'item.sku' } } },
      false,
    ],
    [
      'a path on another root never matches',
      { eq: [{ path: 'input.q' }, { value: 1 }] },
      { eq: [{ path: 'input.q' }, { value: 1 }] },
      false,
    ],
    ['types never mix', { eq: [{ path: 'target.count' }, { value: '3' }] }, gt0, false],
  ]
  test.each(cases)('satisfies: %s', (_, establishes, precondition, expected) => {
    expect(satisfies(establishes, precondition)).toBe(expected)
  })
})

describe('W_UNCONFIRMED_ENABLES', () => {
  const m = fixture('rfc-0001-example.json')
  const enables = (from: string, to: string) => ({
    ...m,
    relations: [{ type: 'enables' as const, from, to }],
  })
  test('a declared enables that is derived is confirmed', () => {
    expect(
      validate(enables('commerce.cart.addItem', 'commerce.cart.checkout')).issues.map(
        (i) => i.code,
      ),
    ).not.toContain('W_UNCONFIRMED_ENABLES')
  })
  test('one nothing derives is the source’s word only', () => {
    const issues = validate(enables('commerce.order.refund', 'commerce.cart.checkout')).issues
    expect(issues.map((i) => `${i.code} ${i.at}`)).toContain('W_UNCONFIRMED_ENABLES /relations/0')
  })
})
