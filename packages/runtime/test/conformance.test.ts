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
    expect(results.map((r) => (r.got.status === 'refused' ? r.got.code : r.got.status))).toEqual(
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
        r.got.status === 'refused' && ['precondition', 'unauthorized'].includes(r.got.code),
      ).toBe(r.pass)
    // and with an arrange that does nothing, on a store nothing was arranged in, those fail too
    const idle = (await application(honest)).fixture
    idle.options.manifest.capabilities[1]!.preconditions!.push(fewSeats)
    idle.arrange = () => {}
    expect((await conformance(idle)).filter((r) => !r.isolated).every((r) => !r.pass)).toBe(true)
  })

  test('a resolver that misreports state fails conformance: the capability ran when it should have refused', async () => {
    const { fixture, runs } = await application(lying)
    const failed = (await conformance(fixture)).filter((r) => !r.pass).map((r) => r.condition)
    expect(failed).toEqual(['hasDomain'])
    expect(runs).toHaveLength(1)
  })
})
