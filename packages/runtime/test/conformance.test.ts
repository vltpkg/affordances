import { describe, expect, test } from 'vitest'
import type { CapabilityManifest } from '@affordances/ir'
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

  test('a resolver that misreports state fails conformance: the capability ran when it should have refused', async () => {
    const { fixture, runs } = await application(lying)
    const failed = (await conformance(fixture)).filter((r) => !r.pass).map((r) => r.condition)
    expect(failed).toEqual(['hasDomain'])
    expect(runs).toHaveLength(1)
  })
})
