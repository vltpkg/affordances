import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { ValidationIssue } from '../src/schema.ts'
import { validate } from '../src/validate.ts'

const fixture = (file: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/valid/${file}`, import.meta.url), 'utf8'))
const codes = (issues: ValidationIssue[]) => issues.map((i) => `${i.code} ${i.at}`)

describe('valid fixtures', () => {
  test.each(readdirSync(new URL('../fixtures/valid', import.meta.url)))('%s validates', (file) => {
    const result = validate(fixture(file))
    expect(codes(result.issues.filter((i) => i.code.startsWith('E_')))).toEqual([])
    expect(result.ok).toBe(true)
  })
  test("plans.json's warnings are the ones it earns", () => {
    // cancel has no preconditions and declared effects; nothing in plans is all-guards
    expect(codes(validate(fixture('plans.json')).issues)).toEqual([])
  })
  test("the RFC's example warns where it should", () => {
    // addItem's only precondition is a guard
    expect(codes(validate(fixture('rfc-0001-example.json')).issues)).toEqual([
      'W_OPAQUE /capabilities/0/preconditions',
    ])
  })
})

// RFC 0001 §7.3: each code, triggered by one change to a valid manifest, reported where the change is.
// E_CONFLICT is compose's, and W_UNCONFIRMED_ENABLES derive's (M2d); W_NO_ID is the v0 adapter's (M2h)
const plans = () => fixture('plans.json')
type M = ReturnType<typeof plans>
const sub = (m: M) => m.capabilities[1]
const cases: [string, ValidationIssue['code'], string, (m: M) => void][] = [
  [
    'an id that breaks the pattern',
    'E_SCHEMA',
    '/resources/0/id',
    (m) => (m.resources[0].id = 'Hosting'),
  ],
  [
    'a binding with no address',
    'E_SCHEMA',
    '/bindings/0/address',
    (m) => (m.bindings[0].address = {}),
  ],
  [
    'two definitions with one id',
    'E_DUPLICATE_ID',
    '/capabilities/0/id',
    (m) => (m.capabilities[0].id = 'hosting.plan'),
  ],
  [
    'two claims with one id',
    'E_DUPLICATE_ID',
    '/claims/1/id',
    (m) => (m.claims[1].id = 'proRecommended'),
  ],
  ['two sources with one id', 'E_DUPLICATE_ID', '/sources/1/id', (m) => (m.sources[1].id = 'host')],
  [
    'a precondition and an authorization condition with one id',
    'E_DUPLICATE_ID',
    '/capabilities/1/authorization/conditions/0/id',
    (m) =>
      (sub(m).authorization.conditions = [
        { id: 'member', description: 'x', expr: { exists: 'principal.plan' } },
      ]),
  ],
  [
    'two references with one name',
    'E_DUPLICATE_ID',
    '/capabilities/1/references/1/name',
    (m) => sub(m).references.push({ ...sub(m).references[0] }),
  ],
  [
    'a target that names nothing',
    'E_UNRESOLVED',
    '/capabilities/1/target',
    (m) => (sub(m).target = 'hosting.planet'),
  ],
  [
    'a target that is a capability',
    'E_UNRESOLVED',
    '/capabilities/1/target',
    (m) => (sub(m).target = 'hosting.plan.list'),
  ],
  [
    'a compensatedBy that names nothing',
    'E_UNRESOLVED',
    '/capabilities/1/effects/0/compensatedBy',
    (m) => (sub(m).effects[0].compensatedBy = 'hosting.plan.undo'),
  ],
  [
    'a replacedBy that names nothing',
    'E_UNRESOLVED',
    '/capabilities/2/deprecated/replacedBy',
    (m) => (m.capabilities[2].deprecated = { replacedBy: 'hosting.plan.stop' }),
  ],
  [
    'a state effect on nothing',
    'E_UNRESOLVED',
    '/capabilities/2/effects/0/resource',
    (m) =>
      (m.capabilities[2].effects = [
        { category: 'state', change: 'delete', resource: 'hosting.sub', description: 'x' },
      ]),
  ],
  [
    'a relation to nothing',
    'E_UNRESOLVED',
    '/relations/0/to',
    (m) => (m.relations[0].to = 'hosting.plan.nope'),
  ],
  [
    'a claim about nothing',
    'E_UNRESOLVED',
    '/claims/0/subject',
    (m) => (m.claims[0].subject = 'hosting.nope'),
  ],
  [
    'a binding for a resource',
    'E_UNRESOLVED',
    '/bindings/0/capability',
    (m) => (m.bindings[0].capability = 'hosting.plan'),
  ],
  [
    'contains that names a capability',
    'E_UNRESOLVED',
    '/resources/0/contains/0',
    (m) => (m.resources[0].contains = ['hosting.plan.list']),
  ],
  [
    'a query with effects',
    'E_KIND',
    '/capabilities/0/effects',
    (m) => (m.capabilities[0].effects = sub(m).effects),
  ],
  [
    'a path to an undeclared attribute',
    'E_PATH',
    '/capabilities/1/preconditions/1/expr/ne/1/path',
    (m) => (sub(m).preconditions[1].expr.ne[1].path = 'target.slugg'),
  ],
  [
    'a principal path to an undeclared attribute',
    'E_PATH',
    '/capabilities/1/preconditions/1/expr/ne/0/path',
    (m) => (sub(m).preconditions[1].expr.ne[0].path = 'principal.tier'),
  ],
  [
    'a principal path with no principal declared',
    'E_PATH',
    '/capabilities/1/preconditions/1/expr/ne/0/path',
    (m) => delete m.principal,
  ],
  [
    'a bare item outside a quantifier',
    'E_PATH',
    '/capabilities/1/preconditions/2/expr/gt/0/count',
    (m) => (sub(m).preconditions[2].expr.gt[0].count = 'item'),
  ],
  [
    'an input path with no input schema',
    'E_PATH',
    '/capabilities/1/preconditions/4/expr/every/of',
    (m) => delete sub(m).input,
  ],
  [
    'a reference path the resource has no attributes for',
    'E_PATH',
    '/capabilities/1/preconditions/0/expr/in/0/path',
    (m) => delete m.resources[1].attributes,
  ],
  [
    'an authorization condition that reads the input',
    'E_PATH',
    '/capabilities/1/authorization/conditions/0/expr/exists',
    (m) =>
      (sub(m).authorization.conditions = [
        { id: 'x', description: 'x', expr: { exists: 'input.projectId' } },
      ]),
  ],
  [
    'an authorization condition that reads a reference',
    'E_PATH',
    '/capabilities/1/authorization/conditions/0/expr/exists',
    (m) =>
      (sub(m).authorization.conditions = [
        { id: 'x', description: 'x', expr: { exists: 'project.orgId' } },
      ]),
  ],
  [
    'a summary placeholder to an undeclared attribute',
    'E_PATH',
    '/capabilities/1/confirmation/summary',
    (m) => (sub(m).confirmation.summary = 'Subscribe to {target.name}'),
  ],
  [
    'a summary that shows a principal attribute',
    'E_PATH',
    '/capabilities/1/confirmation/summary',
    (m) => (sub(m).confirmation.summary = 'Hi {principal.plan}'),
  ],
  [
    'establishes on another resource',
    'E_PATH',
    '/capabilities/2/effects/0/establishes',
    (m) =>
      (m.capabilities[2].effects = [
        {
          category: 'state',
          change: 'update',
          resource: 'hosting.project',
          description: 'x',
          establishes: { exists: 'target.id' },
        },
      ]),
  ],
  [
    'establishes that reads the input',
    'E_PATH',
    '/capabilities/2/effects/0/establishes/exists',
    (m) =>
      (m.capabilities[2].effects = [
        {
          category: 'state',
          change: 'update',
          resource: 'hosting.plan',
          description: 'x',
          establishes: { exists: 'input.x' },
        },
      ]),
  ],
  [
    'applies that reads the principal',
    'E_PATH',
    '/claims/0/applies/eq/0/path',
    (m) => (m.claims[0].applies.eq[0].path = 'principal.plan'),
  ],
  [
    'an alternativeTo between resources',
    'E_UNRESOLVED',
    '/relations/1/from',
    (m) => m.relations.push({ type: 'alternativeTo', from: 'hosting.plan', to: 'hosting.project' }),
  ],
  [
    'an enables from a resource',
    'E_UNRESOLVED',
    '/relations/1/from',
    (m) =>
      m.relations.push({ type: 'enables', from: 'hosting.plan', to: 'hosting.plan.subscribe' }),
  ],
  [
    'in that compares a number with strings',
    'E_TYPE',
    '/capabilities/1/preconditions/0/expr/in',
    (m) => (sub(m).preconditions[0].expr.in[0] = { path: 'target.priceUsd' }),
  ],
  [
    'in with an array on the left',
    'E_TYPE',
    '/capabilities/1/preconditions/0/expr/in/0',
    (m) => (sub(m).preconditions[0].expr.in[0] = { path: 'target.regions' }),
  ],
  [
    'a path through a schema that declares nothing',
    'W_PATH_UNCHECKED',
    '/capabilities/1/preconditions/6/expr/exists',
    (m) => {
      m.resources[0].attributes.properties.meta = { type: 'object', additionalProperties: true }
      sub(m).preconditions.push({
        id: 'meta',
        description: 'x',
        expr: { exists: 'target.meta.anything' },
      })
    },
  ],
  [
    'targetAt without a target',
    'E_SCHEMA',
    '/capabilities/1/targetAt',
    (m) => delete sub(m).target,
  ],
  [
    'a targetAt the input lacks',
    'E_PATH',
    '/capabilities/1/targetAt',
    (m) => (sub(m).targetAt = '/plan'),
  ],
  [
    'a targetAt with no input',
    'E_PATH',
    '/capabilities/2/targetAt',
    (m) => (m.capabilities[2].targetAt = '/planId'),
  ],
  [
    'a reference at the input lacks',
    'E_PATH',
    '/capabilities/1/references/0/at',
    (m) => (sub(m).references[0].at = '/project'),
  ],
  [
    'a key that is not an attribute',
    'E_KEY',
    '/resources/0/key',
    (m) => (m.resources[0].key = 'name'),
  ],
  [
    'ordering a string against a number',
    'E_TYPE',
    '/capabilities/1/preconditions/1/expr/lt',
    (m) => (sub(m).preconditions[1].expr = { lt: [{ path: 'target.slug' }, { value: 3 }] }),
  ],
  [
    'eq between a string and a boolean',
    'E_TYPE',
    '/capabilities/1/preconditions/1/expr/eq',
    (m) => (sub(m).preconditions[1].expr = { eq: [{ path: 'target.slug' }, { value: true }] }),
  ],
  [
    'a null literal',
    'E_TYPE',
    '/capabilities/1/preconditions/1/expr/ne/1/value',
    (m) => (sub(m).preconditions[1].expr.ne[1] = { value: null }),
  ],
  [
    'an array literal outside in',
    'E_TYPE',
    '/capabilities/1/preconditions/1/expr/ne/1/value',
    (m) => (sub(m).preconditions[1].expr.ne[1] = { value: ['a'] }),
  ],
  [
    'in against a string',
    'E_TYPE',
    '/capabilities/1/preconditions/0/expr/in/1',
    (m) => (sub(m).preconditions[0].expr.in[1] = { path: 'target.slug' }),
  ],
  [
    'count of a string',
    'E_TYPE',
    '/capabilities/1/preconditions/2/expr/gt/0/count',
    (m) => (sub(m).preconditions[2].expr.gt[0].count = 'target.slug'),
  ],
  [
    'a quantifier over a string',
    'E_TYPE',
    '/capabilities/1/preconditions/3/expr/some/of',
    (m) => (sub(m).preconditions[3].expr.some.of = 'target.slug'),
  ],
  [
    'three nested quantifiers',
    'E_DEPTH',
    '/capabilities/1/preconditions/3/expr/some/where/every/where/some',
    (m) =>
      (sub(m).preconditions[3].expr.some.where.every.where = {
        some: { of: 'target.regions', where: { exists: 'item.code' } },
      }),
  ],
  [
    'a claim about confirmation',
    'E_ENFORCEMENT_CLAIM',
    '/claims/0/about',
    (m) => (m.claims[0].about = '/confirmation/summary'),
  ],
  [
    'a claim about kind',
    'E_ENFORCEMENT_CLAIM',
    '/claims/0/about',
    (m) => (m.claims[0].about = '/kind'),
  ],
  [
    'verified by the owner',
    'E_BASIS',
    '/claims/1/provenance/basis',
    (m) => (m.claims[1].provenance.source = 'host'),
  ],
  [
    'declared by a third party',
    'E_BASIS',
    '/provenance/basis',
    (m) => (m.provenance.source = 'monitor'),
  ],
  [
    'verified without evidence',
    'E_BASIS',
    '/claims/1/provenance/evidence',
    (m) => delete m.claims[1].provenance.evidence,
  ],
  [
    'a source nobody declared',
    'E_SOURCE',
    '/claims/0/provenance/source',
    (m) => (m.claims[0].provenance.source = 'nobody'),
  ],
  [
    'a field provenance with an undeclared source',
    'E_SOURCE',
    '/capabilities/1/fieldProvenance/~1input/source',
    (m) => (sub(m).fieldProvenance = { '/input': { source: 'compiler', basis: 'inferred' } }),
  ],
  [
    'every precondition a guard',
    'W_OPAQUE',
    '/capabilities/1/preconditions',
    (m) => (sub(m).preconditions = [{ id: 'g', description: 'g', guard: true }]),
  ],
  [
    'an action with unknown effects',
    'W_EFFECTS_UNKNOWN',
    '/capabilities/2/effects',
    (m) => delete m.capabilities[2].effects,
  ],
]

describe('every code', () => {
  test.each(cases)('%s: %s at %s', (_, code, at, mutate) => {
    const m = plans()
    mutate(m)
    const result = validate(m)
    expect(codes(result.issues)).toContain(`${code} ${at}`)
    expect(result.ok).toBe(!code.startsWith('E_'))
  })

  test('each of validate’s codes has a case', () => {
    const own = [
      'E_SCHEMA',
      'E_DUPLICATE_ID',
      'E_UNRESOLVED',
      'E_KIND',
      'E_PATH',
      'E_KEY',
      'E_TYPE',
      'E_DEPTH',
    ]
    const rest = [
      'E_ENFORCEMENT_CLAIM',
      'E_BASIS',
      'E_SOURCE',
      'W_OPAQUE',
      'W_EFFECTS_UNKNOWN',
      'W_PATH_UNCHECKED',
    ]
    expect(new Set(cases.map(([, code]) => code))).toEqual(new Set([...own, ...rest]))
  })
})

test('a remote Ref is left alone, and one in this namespace is checked', () => {
  const m = plans()
  m.relations[0].to = 'https://other.example/capabilities#billing.invoice'
  expect(validate(m).ok).toBe(true)
  m.relations[0].to = 'https://hosting.example/capabilities#hosting.nope'
  expect(codes(validate(m).issues)).toContain('E_UNRESOLVED /relations/0/to')
})

test('an open schema is checked at run time, not rejected', () => {
  const m = plans()
  // a property with no type: paths below it can't be checked statically
  m.resources[0].attributes.properties.meta = {}
  sub(m).preconditions.push({
    id: 'meta',
    description: 'x',
    expr: { exists: 'target.meta.anything' },
  })
  const result = validate(m)
  expect(result.ok).toBe(true)
  // and says it couldn't check it
  expect(result.issues.map((x) => x.code)).toEqual(['W_PATH_UNCHECKED'])
})

test('additionalProperties: true and {} are both open', () => {
  for (const open of [true, {}]) {
    const m = plans()
    m.resources[0].attributes.additionalProperties = open
    sub(m).preconditions.push({ id: 'extra', description: 'x', expr: { exists: 'target.extra' } })
    const result = validate(m)
    expect(result.ok).toBe(true)
    expect(result.issues.map((x) => x.code)).toEqual(['W_PATH_UNCHECKED'])
  }
})

test("a claim about another manifest's capability can say when it applies", () => {
  const m = plans()
  m.claims[0].subject = 'https://other.example/capabilities#billing.plan.subscribe'
  expect(validate(m).ok).toBe(true)
})

describe('a schema node that is not a schema', () => {
  // validate returns issues for any input; it never throws (review's probe)
  test.each([null, 'event', 5, [1]])(
    'an attribute schema of %j is E_SCHEMA at the path, not a throw',
    (junk) => {
      const m = plans()
      m.resources[0].attributes.properties.priceUsd = junk
      sub(m).preconditions.push({
        id: 'p',
        description: 'x',
        expr: { exists: 'target.priceUsd.sub' },
      })
      const result = validate(m)
      expect(codes(result.issues)).toContain('E_SCHEMA /capabilities/1/preconditions/6/expr/exists')
      expect(result.ok).toBe(false)
    },
  )
  test('a boolean schema: true allows anything, false declares nothing', () => {
    const m = plans()
    m.resources[0].attributes.properties.any = true
    m.resources[0].attributes.properties.none = false
    sub(m).preconditions.push(
      { id: 'a', description: 'x', expr: { exists: 'target.any.deep' } },
      { id: 'b', description: 'x', expr: { exists: 'target.none' } },
    )
    expect(codes(validate(m).issues)).toEqual([
      'W_PATH_UNCHECKED /capabilities/1/preconditions/6/expr/exists',
      'E_PATH /capabilities/1/preconditions/7/expr/exists',
    ])
  })
  // 2,000 runs: about 1s on a quiet machine, so a generous timeout for a loaded one
  test('junk anywhere in an embedded schema never throws', { timeout: 60_000 }, () => {
    const junk = [
      null,
      'x',
      5,
      true,
      false,
      [],
      [null],
      {},
      { properties: 5 },
      { items: 'x' },
      { additionalProperties: 3 },
    ]
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (let run = 0; run < 2000; run++) {
      const m = plans()
      const attrs = m.resources[0].attributes
      const key = ['slug', 'priceUsd', 'regions'][Math.floor(next() * 3)]!
      const value = junk[Math.floor(next() * junk.length)]
      if (next() < 0.5) attrs.properties[key] = value
      else attrs.properties.regions.items = value
      expect(() => validate(m)).not.toThrow()
    }
  })
})

// review's close-out: names are a schema's own, never inherited, and validate reports, never throws
describe('own names only', () => {
  test.for(['a string', 7, true] as const)(
    'attributes.properties that is %j is E_SCHEMA, not a throw',
    (junk) => {
      const m = plans()
      m.resources[0].attributes.properties = junk
      const result = validate(m)
      expect(result.ok).toBe(false)
      expect(codes(result.issues)).toContain('E_SCHEMA /resources/0/attributes/properties')
    },
  )
  test.for(['constructor', 'toString', '__proto__'])(
    'a key named %s that no attribute has is E_KEY',
    (key) => {
      const m = plans()
      m.resources[0].key = key
      expect(codes(validate(m).issues)).toContain('E_KEY /resources/0/key')
    },
  )
  test.for(['__proto__', 'constructor', 'hasOwnProperty'])(
    'a path to target.%s on a closed schema is E_PATH, as any undeclared attribute is',
    (name) => {
      const m = plans()
      m.resources[0].attributes.additionalProperties = false
      sub(m).preconditions.push({
        id: 'odd',
        description: 'an inherited name',
        expr: { exists: `target.${name}` },
      })
      const at = `/capabilities/1/preconditions/${sub(m).preconditions.length - 1}/expr/exists`
      expect(codes(validate(m).issues)).toContain(`E_PATH ${at}`)
    },
  )
})
