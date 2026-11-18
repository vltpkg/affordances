import { describe, expect, test } from 'vitest'
import type { CapabilityManifest, Expr } from '@affordances/ir'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import { conformance } from '../src/index.ts'
import type { ConformanceFixture, ResourceResolver, TokenStore } from '../src/index.ts'

type Store = Record<string, Record<string, Record<string, unknown>>>
// an application in miniature: resolvers over a store, a token store, and real handlers that record each run
const application = async (resolverOf: (store: Store, type: string) => ResourceResolver) => {
  const store: Store = {}
  const runs: string[] = []
  const seen = new Set<string>()
  const seenTokens: TokenStore = { claim: async (n) => (seen.has(n) ? false : (seen.add(n), true)) }
  const manifest = structuredClone(plansJson) as unknown as CapabilityManifest
  const fixture: ConformanceFixture = {
    options: {
      manifest,
      resources: {
        'hosting.plan': resolverOf(store, 'hosting.plan'),
        'hosting.project': resolverOf(store, 'hosting.project'),
      },
      handlers: {
        'hosting.plan.list': { run: () => [] },
        'hosting.plan.cancel': { run: () => undefined },
        'hosting.plan.subscribe': {
          guards: { billing: () => true },
          run: (input) => {
            runs.push(JSON.stringify(input))
            return { ok: true }
          },
        },
      },
      approvalKeys: {
        current: await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
          'sign',
          'verify',
        ]),
      },
      seenTokens,
    },
    arrange: (type, key, attributes) => {
      ;(store[type] ??= {})[key] = attributes
    },
    principal: { authenticated: true, subject: 'kit', attributes: {} },
    input: () => ({ projectId: 'unset', seats: [] }),
  }
  return { fixture, runs }
}
const honest = (store: Store, type: string): ResourceResolver => ({
  load: async (key) => (store[type]?.[key] ? { attributes: store[type][key] } : null),
})

// it reports every project as having a domain, whatever was arranged
const lying = (store: Store, type: string): ResourceResolver => ({
  load: async (key) => {
    const attributes = store[type]?.[key]
    if (!attributes) return null
    return type === 'hosting.project'
      ? { attributes: { ...attributes, domains: ['a.example'] } }
      : { attributes }
  },
})

// implies seatsInRange (at most 50), so neither can be made false alone: a case that isn't isolated
const fewSeats: { id: string; description: string; expr: Expr } = {
  id: 'fewSeats',
  description: 'Every seat count is at most 10',
  expr: { every: { of: 'input.seats', where: { le: [{ path: 'item' }, { value: 10 }] } } },
}

// a resolver that says every plan is free, whatever was arranged
const free = (store: Store, type: string): ResourceResolver => ({
  load: async (key) => {
    const attributes = store[type]?.[key]
    if (!attributes) return null
    return { attributes: type === 'hosting.plan' ? { ...attributes, priceUsd: 0 } : attributes }
  },
})

// a resolver that says every plan costs 5, whatever was arranged
const priced = (store: Store, type: string): ResourceResolver => ({
  load: async (key) => {
    const attributes = store[type]?.[key]
    if (!attributes) return null
    return { attributes: type === 'hosting.plan' ? { ...attributes, priceUsd: 5 } : attributes }
  },
})

describe('rule 5’s conformance kit (§9, R5)', () => {
  test('every declared precondition of a conformant application refuses in the state that falsifies it', async () => {
    const { fixture, runs } = await application(honest)
    const results = await conformance(fixture)
    // the plans fixture's subscribe: member, notCurrent, hasDomain, regionUp, seatsInRange, and the billing guard
    expect(results.map((r) => [r.condition, r.kind, r.pass])).toEqual([
      ['member', 'declarative', true],
      ['notCurrent', 'declarative', true],
      ['hasDomain', 'declarative', true],
      ['regionUp', 'declarative', true],
      ['seatsInRange', 'declarative', true],
      ['billing', 'guard', true],
    ])
    expect(runs).toEqual([])
  })

  test('an arrange that does nothing fails every case: not_found is never a pass', async () => {
    const { fixture, runs } = await application(honest)
    fixture.arrange = () => {}
    const results = await conformance(fixture)
    expect(results.every((r) => !r.pass)).toBe(true)
    expect(results.map((r) => (r.got?.status === 'refused' ? r.got.code : r.got?.status))).toEqual(
      results.map(() => 'not_found'),
    )
    expect(runs).toEqual([])
  })

  test('a non-isolated case passes only on a condition’s refusal', async () => {
    const { fixture } = await application(honest)
    fixture.options.manifest.capabilities[1]!.preconditions!.push(fewSeats)
    const results = await conformance(fixture)
    const loose = results.filter((r) => !r.isolated)
    expect(loose.length).toBeGreaterThan(0)
    for (const r of loose)
      expect(
        r.got?.status === 'refused' && ['precondition', 'unauthorized'].includes(r.got.code),
      ).toBe(r.pass)
    // and with an arrange that does nothing, on a store nothing was arranged in, those fail too
    const idle = (await application(honest)).fixture
    idle.options.manifest.capabilities[1]!.preconditions!.push(fewSeats)
    idle.arrange = () => {}
    expect((await conformance(idle)).filter((r) => !r.isolated).every((r) => !r.pass)).toBe(true)
  })

  test('6: a non-isolated case fails on a refusal no false condition explains (code review)', async () => {
    // a capability that doesn't enforce cheap (its resolver says every plan is free), and a caller with no subject:
    // the only refusal left is step 8's, unauthorized with no condition, which must not pass the case
    const anonymous = (await application(free)).fixture
    // cheap implies veryCheap's opposite can't hold alone: cheap false (30 or more) makes veryCheap false too
    anonymous.options.manifest.capabilities[1]!.preconditions!.push(
      {
        id: 'cheap',
        description: 'Under 30 USD',
        expr: { lt: [{ path: 'target.priceUsd' }, { value: 30 }] },
      },
      {
        id: 'veryCheap',
        description: 'Under 10 USD',
        expr: { lt: [{ path: 'target.priceUsd' }, { value: 10 }] },
      },
    )
    anonymous.principal = { authenticated: true, attributes: {} }
    const a = (await conformance(anonymous)).filter((r) => r.condition === 'cheap')
    expect(a.map((r) => [r.isolated, r.pass, r.got?.status === 'refused' && r.got.code])).toEqual([
      [false, false, 'unauthorized'],
    ])
    // no authorization declared: every call is unauthorized with no condition
    const open = (await application(honest)).fixture
    open.options.manifest.capabilities[1]!.preconditions!.push(fewSeats)
    delete open.options.manifest.capabilities[1]!.authorization
    const b = (await conformance(open)).filter((r) => !r.isolated)
    expect(b.map((r) => [r.condition, r.pass])).toEqual(b.map((r) => [r.condition, false]))
  })

  test('a non-isolated case never passes on a condition its own doesn’t imply (review a)', async () => {
    // slugIsX and slugIsY can't both hold, so priced can't be isolated, and the greedy drop gives up slugIsX, which
    // priced doesn't imply. A resolver that says every plan costs 5 ignores priced, so only slugIsX refuses
    const { fixture } = await application(priced)
    // just these three, so nothing else gets in the way of the drop
    fixture.options.manifest.capabilities[1]!.preconditions = []
    fixture.options.manifest.capabilities[1]!.preconditions!.push(
      {
        id: 'priced',
        description: 'Not free',
        expr: { gt: [{ path: 'target.priceUsd' }, { value: 0 }] },
      },
      {
        id: 'slugIsX',
        description: 'Plan x',
        expr: { eq: [{ path: 'target.slug' }, { value: 'x' }] },
      },
      {
        id: 'slugIsY',
        description: 'Plan y',
        expr: { eq: [{ path: 'target.slug' }, { value: 'y' }] },
      },
    )
    const r = (await conformance(fixture)).find((x) => x.condition === 'priced')!
    expect(r.isolated).toBe(false)
    expect(r.got).toMatchObject({
      status: 'refused',
      code: 'precondition',
      condition: { id: 'slugIsX' },
    })
    expect(r.pass).toBe(false)
  })

  // review of bb61e4e2: the search's witness for 'some US region with zones' had zones: '~fresh', which the declared
  // array schema rejects, so the plan loaded as unknown and a conformant app failed
  const usRegion: { id: string; description: string; expr: Expr } = {
    id: 'usRegion',
    description: 'Served from a US region with zones',
    expr: {
      some: {
        of: 'target.regions',
        where: {
          all: [{ eq: [{ path: 'item.code' }, { value: 'us' }] }, { exists: 'item.zones' }],
        },
      },
    },
  }
  const cheap: { id: string; description: string; expr: Expr } = {
    id: 'cheap',
    description: 'Under 30 USD',
    expr: { lt: [{ path: 'target.priceUsd' }, { value: 30 }] },
  }
  test('arranged attributes fit their declared schemas: a conformant app passes every case', async () => {
    const { fixture } = await application(honest)
    fixture.options.manifest.capabilities[1]!.preconditions = [usRegion, cheap]
    const results = await conformance(fixture)
    for (const id of ['usRegion', 'cheap'])
      expect(results.find((r) => r.condition === id)).toMatchObject({ pass: true })
  })
  test('and a resolver that misreports the price still fails its case', async () => {
    const { fixture } = await application(free)
    fixture.options.manifest.capabilities[1]!.preconditions = [usRegion, cheap]
    const results = await conformance(fixture)
    expect(results.find((r) => r.condition === 'cheap')).toMatchObject({ pass: false })
    expect(results.find((r) => r.condition === 'usRegion')).toMatchObject({ pass: true })
  })

  test('a condition the kit can’t test is a failure with its reason, never a silent skip (review’s close-out)', async () => {
    const { fixture } = await application(honest)
    const subscribe = fixture.options.manifest.capabilities[1]!
    // no state makes it false: a supplied price is a number or not, and either way one side holds
    subscribe.preconditions = [
      {
        id: 'always',
        description: 'A price, or none',
        expr: { any: [{ exists: 'target.priceUsd' }, { not: { exists: 'target.priceUsd' } }] },
      },
    ]
    const results = await conformance(fixture)
    expect(results).toContainEqual(
      expect.objectContaining({
        condition: 'always',
        pass: false,
        reason: 'untested: no state makes this condition false',
      }),
    )
  })
  test('a guard no state lets act alone is a failure with its reason', async () => {
    const { fixture } = await application(honest)
    const subscribe = fixture.options.manifest.capabilities[1]!
    // the declarative conditions can't all hold at once, so no state isolates the guard
    subscribe.preconditions = [
      { id: 'isX', description: 'Plan x', expr: { eq: [{ path: 'target.slug' }, { value: 'x' }] } },
      { id: 'isY', description: 'Plan y', expr: { eq: [{ path: 'target.slug' }, { value: 'y' }] } },
      { id: 'billing', description: 'Billing is in good standing', guard: true },
    ]
    const results = await conformance(fixture)
    expect(results.find((r) => r.condition === 'billing')).toMatchObject({
      kind: 'guard',
      pass: false,
      reason: expect.stringMatching(/^untested/),
    })
  })

  test('a resolver that misreports state fails conformance: the capability ran when it should have refused', async () => {
    const { fixture, runs } = await application(lying)
    const failed = (await conformance(fixture)).filter((r) => !r.pass).map((r) => r.condition)
    expect(failed).toEqual(['hasDomain'])
    expect(runs).toHaveLength(1)
  })
})
