import { expect, test } from 'vitest'
import { z } from 'zod'
import {
  brandOf,
  canonicalize,
  defineCapability,
  defineClaims,
  defineManifest,
  definePrincipal,
  defineRelations,
  defineResource,
  fromModules,
  when,
} from '../src/index.ts'

// RFC 0005 §1: capability modules' exports, as a compiler hands them over after evaluating each capabilities.ts
const plan = defineResource({
  id: 'hosting.plan',
  description: 'A plan',
  key: 'slug',
  attributes: z.object({ slug: z.string(), priceUsd: z.number() }),
  alternatives: true,
})
const subscribe = defineCapability({
  id: 'hosting.plan.subscribe',
  kind: 'action',
  description: 'Subscribe to a plan',
  target: plan,
  authorization: { principal: 'authenticated' },
})
const subscribeBundle = defineCapability({
  id: 'hosting.bundle.subscribe',
  kind: 'action',
  description: 'Subscribe to a bundle',
  authorization: { principal: 'authenticated' },
})
const recommended = defineClaims({
  proRecommended: {
    subject: subscribe,
    kind: 'recommendation',
    statement: 'Recommended for production',
    applies: when.eq('target.slug', 'pro'),
  },
})
const alternatives = defineRelations([
  { type: 'alternativeTo', from: subscribeBundle, to: subscribe, description: 'Same goal' },
])
const owner = { id: 'host', name: 'Host' }
// validate's warnings, such as W_EFFECTS_UNKNOWN on these bare capabilities, pass through; errors are what stop a build
const errors = <D extends { code: string }>(diagnostics: D[]) =>
  diagnostics.filter((d) => d.code.startsWith('E_'))

test('every authored value is branded, out of sight of JSON', () => {
  expect(brandOf(plan)).toBe('resource')
  expect(brandOf(definePrincipal({ attributes: z.object({ id: z.string() }) }))).toBe('principal')
  expect(brandOf(subscribe)).toBe('capability')
  expect(brandOf(recommended)).toBe('claims')
  expect(brandOf(alternatives)).toBe('relations')
  expect(
    brandOf(
      defineManifest({
        namespace: 'https://host.example/capabilities',
        owner,
        resources: [plan],
        capabilities: [subscribe],
      }),
    ),
  ).toBe('manifest')
  expect(Object.keys(plan)).not.toContain(Symbol.for('affordances.defined'))
  expect(JSON.stringify(plan)).toBe(JSON.stringify({ ...plan }))
  for (const value of [undefined, null, 1, 'resource', {}, { definition: {} }])
    expect(brandOf(value)).toBeUndefined()
})

test('modules merge into the manifest defineManifest would make from the same definitions', () => {
  const { manifest, diagnostics } = fromModules(
    [
      { file: 'app/capabilities.ts', exports: { plan, alternatives, schema: z.string() } },
      { file: 'app/plans/capabilities.ts', exports: { subscribe, subscribeBundle, recommended } },
    ],
    { namespace: 'https://host.example/capabilities', owner },
  )
  expect(errors(diagnostics)).toEqual([])
  const direct = defineManifest({
    namespace: 'https://host.example/capabilities',
    owner,
    resources: [plan],
    capabilities: [subscribe, subscribeBundle],
    claims: [recommended],
    relations: alternatives.relations,
  })
  expect(canonicalize(manifest!)).toEqual(canonicalize(direct))
})

test("the modules' order doesn't show in the manifest", () => {
  const a = { file: 'a/capabilities.ts', exports: { plan, subscribe } }
  const b = { file: 'b/capabilities.ts', exports: { subscribeBundle, alternatives } }
  const one = fromModules([a, b], {
    namespace: 'https://host.example/capabilities',
    owner,
  }).manifest
  const other = fromModules([b, a], {
    namespace: 'https://host.example/capabilities',
    owner,
  }).manifest
  expect(one).toBeDefined()
  expect(JSON.stringify(one)).toBe(JSON.stringify(other))
})

test('one definition exported twice, or re-exported, is one definition', () => {
  const { manifest, diagnostics } = fromModules(
    [
      { file: 'app/capabilities.ts', exports: { plan, alsoPlan: plan } },
      { file: 'app/plans/capabilities.ts', exports: { plan, subscribe } },
    ],
    { namespace: 'https://host.example/capabilities', owner },
  )
  expect(errors(diagnostics)).toEqual([])
  expect(manifest?.resources.map((r) => r.id)).toEqual(['hosting.plan'])
})

test('two different definitions with one id are reported with both places, and nothing is built', () => {
  const other = defineResource({ id: 'hosting.plan', description: 'Another plan', key: 'slug' })
  const result = fromModules(
    [
      { file: 'app/capabilities.ts', exports: { plan } },
      { file: 'app/admin/capabilities.ts', exports: { other, subscribe } },
    ],
    { namespace: 'https://host.example/capabilities', owner },
  )
  expect(result.manifest).toBeUndefined()
  expect(result.diagnostics).toEqual([
    {
      code: 'E_CAPABILITY_DUPLICATE',
      file: 'app/admin/capabilities.ts',
      subject: 'hosting.plan',
      message:
        'hosting.plan is defined differently by plan in app/capabilities.ts and other in app/admin/capabilities.ts',
    },
  ])
})

test('a resource and a capability with one id are reported, not merged', () => {
  const clash = defineCapability({
    id: 'hosting.plan',
    kind: 'query',
    description: 'Read the plan',
    authorization: { principal: 'any' },
  })
  const result = fromModules([{ file: 'app/capabilities.ts', exports: { plan, clash } }], {
    namespace: 'https://host.example/capabilities',
    owner,
  })
  expect(result.manifest).toBeUndefined()
  expect(errors(result.diagnostics).map((d) => [d.code, d.subject])).toEqual([
    ['E_CAPABILITY_DUPLICATE', 'hosting.plan'],
  ])
})

test('a defineManifest export is used whole, and nothing may sit beside it', () => {
  const whole = defineManifest({
    namespace: 'https://lab.example/capabilities',
    owner,
    resources: [plan],
    capabilities: [subscribe],
  })
  const withAll = defineManifest({
    namespace: 'https://lab.example/capabilities',
    owner,
    resources: [plan],
    capabilities: [subscribe, subscribeBundle],
    claims: [recommended],
    relations: alternatives.relations,
  })
  const alone = fromModules([{ file: 'app/capabilities.ts', exports: { whole } }], {
    namespace: 'other',
  })
  expect(alone.diagnostics).toEqual([])
  expect(alone.manifest).toBe(whole)

  // its own parts may sit beside it, as an app's bound actions import them
  const parts = fromModules(
    [
      {
        file: 'app/capabilities.ts',
        exports: { plan, subscribe, recommended, alternatives, whole: withAll },
      },
    ],
    { namespace: 'https://other.example/capabilities' },
  )
  expect(parts.diagnostics).toEqual([])
  expect(parts.manifest).toBe(withAll)

  // anything it doesn't hold would be left out, so it's refused
  const beside = fromModules(
    [
      { file: 'app/capabilities.ts', exports: { whole } },
      { file: 'app/plans/capabilities.ts', exports: { subscribe, subscribeBundle } },
    ],
    { namespace: 'https://lab.example/capabilities', owner },
  )
  expect(beside.manifest).toBeUndefined()
  expect(beside.diagnostics.map((d) => [d.code, d.subject])).toEqual([
    ['E_CAPABILITY_MANIFEST', 'subscribeBundle'],
  ])
})

test('without a namespace nothing is built, and the modules are still checked; W_NO_NAMESPACE is the caller’s to report', () => {
  const result = fromModules([{ file: 'app/capabilities.ts', exports: { plan, subscribe } }], {
    owner,
  })
  expect(result.manifest).toBeUndefined()
  // reported once, by withAffordances, with the line to paste; not again here (M5 boundary review, #10). The reason
  // says why nothing was built, so a caller can't read the silence as success
  expect(result.diagnostics).toEqual([])
  expect(result.reason).toBe('no-namespace')

  // a module's own errors show before a namespace is set, not only after
  const other = defineResource({ id: 'hosting.plan', description: 'Another plan', key: 'slug' })
  const broken = fromModules(
    [
      { file: 'app/capabilities.ts', exports: { plan, subscribe, recommended } },
      { file: 'app/admin/capabilities.ts', exports: { other } },
    ],
    {},
  )
  expect(broken.manifest).toBeUndefined()
  // the modules' own errors are the reason here
  expect(broken.reason).toBeUndefined()
  expect(broken.diagnostics.map((d) => d.code).toSorted()).toEqual([
    'E_CAPABILITY_DUPLICATE',
    'E_CLAIMS_NO_OWNER',
    'W_NO_OWNER',
  ])
})

test('without an owner nothing is declared, and a claim, being the owner’s, is an error', () => {
  const unowned = fromModules([{ file: 'app/capabilities.ts', exports: { plan, subscribe } }], {
    namespace: 'https://host.example/capabilities',
  })
  expect(unowned.diagnostics.map((d) => d.code)).toContain('W_NO_OWNER')
  expect(errors(unowned.diagnostics)).toEqual([])
  expect(unowned.manifest?.provenance.basis).toBe('inferred')
  expect(JSON.stringify(unowned.manifest)).not.toContain('"declared"')

  const claimed = fromModules(
    [{ file: 'app/capabilities.ts', exports: { plan, subscribe, recommended } }],
    {
      namespace: 'https://host.example/capabilities',
    },
  )
  expect(claimed.manifest).toBeUndefined()
  expect(errors(claimed.diagnostics).map((d) => [d.code, d.subject])).toEqual([
    ['E_CLAIMS_NO_OWNER', 'recommended'],
  ])
})

test("validate's errors are reported, not thrown: a capability whose resource no module exports", () => {
  const result = fromModules([{ file: 'app/plans/capabilities.ts', exports: { subscribe } }], {
    namespace: 'https://host.example/capabilities',
    owner,
  })
  expect(result.manifest).toBeUndefined()
  expect(result.diagnostics.some((d) => d.code.startsWith('E_'))).toBe(true)
})
