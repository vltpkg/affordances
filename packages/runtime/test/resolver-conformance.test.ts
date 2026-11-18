import type { CapabilityManifest } from '@affordances/ir'
import { expect, test } from 'vitest'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import { resolverConformance } from '../src/index.ts'
import type { Principal, ResourceResolver } from '../src/index.ts'
import { testRuntime } from './support/runtime.ts'

// the resolver contract (RFC 0002 §2.1; intake, 2026-11-18 16:33Z): a resolver MUST return null for a resource its
// principal can't read, since the runtime evaluates conditions on whatever it returns

type Row = Record<string, unknown>
const projects: Record<string, Row> = {
  p1: { id: 'p1', orgId: 'o1', domains: ['a.example'] },
  p2: { id: 'p2', orgId: 'o2', domains: ['b.example'] },
}
const alice: Principal = { authenticated: true, subject: 'alice', attributes: { orgIds: ['o1'] } }
const bob: Principal = { authenticated: true, subject: 'bob', attributes: { orgIds: ['o2'] } }
const orgsOf = (p: Principal) => ((p.attributes as { orgIds?: string[] }).orgIds ?? []) as string[]
// scoped: a project loads, and is listed, only for a member of its organization
const scoped: ResourceResolver = {
  load: async (key, p) =>
    projects[key] && orgsOf(p).includes(String(projects[key]!.orgId))
      ? { attributes: projects[key]! }
      : null,
  list: async (p) =>
    Object.keys(projects).filter((k) => orgsOf(p).includes(String(projects[k]!.orgId))),
}
// unscoped: what the contract forbids, a resolver that ignores its principal
const unscoped: ResourceResolver = {
  load: async (key) => (projects[key] ? { attributes: projects[key]! } : null),
  list: async () => Object.keys(projects),
}
const fixture = (projectResolver: ResourceResolver) => ({
  resources: { 'hosting.project': projectResolver },
  principals: [
    { principal: alice, reads: { 'hosting.project': ['p1'] } },
    { principal: bob, reads: { 'hosting.project': ['p2'] } },
  ] as [
    { principal: Principal; reads: Record<string, string[]> },
    { principal: Principal; reads: Record<string, string[]> },
  ],
})

test('a scoped resolver passes: each resource loads for its owner, and not for the other principal or anonymous', async () => {
  const results = await resolverConformance(fixture(scoped))
  expect(results.filter((r) => !r.pass)).toEqual([])
  // two resources, each loaded by three principals and listed by two
  expect(results).toHaveLength(2 * (3 + 2))
})

test('an unscoped resolver fails, naming the resolver, the resource, the principal and the check', async () => {
  const failed = (await resolverConformance(fixture(unscoped))).filter((r) => !r.pass)
  expect(
    failed.map((r) => `${r.resolver} ${r.resource} ${r.principal} ${r.check}`).toSorted(),
  ).toEqual([
    'hosting.project p1 anonymous list',
    'hosting.project p1 anonymous load',
    'hosting.project p1 other list',
    'hosting.project p1 other load',
    'hosting.project p2 anonymous list',
    'hosting.project p2 anonymous load',
    'hosting.project p2 other list',
    'hosting.project p2 other load',
  ])
  expect(failed[0]!.reason).toMatch(/can read it|includes it/)
})

test('a fixture whose owner can’t read its own resource fails too, so loading nothing can’t pass', async () => {
  const nothing: ResourceResolver = { load: async () => null, list: async () => [] }
  const failed = (await resolverConformance(fixture(nothing))).filter((r) => !r.pass)
  expect(failed.map((r) => `${r.resource} ${r.principal}`)).toEqual(['p1 owner', 'p2 owner'])
})

// the planner (16:33Z): a start whose resolver returns null loads nothing: no offer bound to it, no condition on it
test('a start the principal can’t read loads nothing: no bound offer and no condition evaluated on it', async () => {
  const plans = {
    hobby: { slug: 'hobby', priceUsd: 0, regions: [{ code: 'us', zones: [{ up: true }] }] },
  }
  const rt = testRuntime({
    manifest: structuredClone(plansJson) as unknown as CapabilityManifest,
    resources: {
      'hosting.plan': {
        load: async (k) => (plans[k as 'hobby'] ? { attributes: plans[k as 'hobby'] } : null),
        list: async () => ['hobby'],
      },
      'hosting.project': scoped,
    },
    handlers: { 'hosting.plan.subscribe': { guards: { billing: () => true }, run: () => 'ok' } },
  })
  const fromOthers = (
    await rt.project({
      principal: alice,
      start: { type: 'hosting.project', key: 'p2' },
      policy: 'exhaustive',
    })
  ).view()
  const siteWide = (await rt.project({ principal: alice, policy: 'exhaustive' })).view()
  const bytes = JSON.stringify(fromOthers)
  expect(bytes).not.toContain('p2')
  expect(bytes).not.toContain('b.example')
  expect(fromOthers.offers.map((o) => o.id).toSorted()).toEqual(
    siteWide.offers.map((o) => o.id).toSorted(),
  )
})
