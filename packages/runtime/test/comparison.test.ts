import { canonicalJson, type CapabilityManifest } from '@affordances/ir'
import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import {
  builtInPolicies,
  keptColumns,
  type Comparison,
  type DiscoveryPolicy,
  type Principal,
  type ProjectionRequest,
  type ResourceResolver,
  type View,
} from '../src/index.ts'
import { testRuntime } from './support/runtime.ts'

// RFC 0002 §6.6, rule 6 of the disclosure invariant (M7a): every choice set a view carries comes with its comparison,
// every declared attribute of every member; no policy removes it, and only a request's own facts limit cuts it, by
// named column, never a cited or read one

// the plans fixture with three more declared attributes: bandwidthGb, which a claim cites; tagline, which team's
// resolver leaves out; and support, the same on every plan. And a trial on each plan, an alternative to subscribing,
// whose capability reads nothing, so its columns can be cut
const manifestOf = (): CapabilityManifest => {
  const m = structuredClone(plansJson) as unknown as CapabilityManifest
  const plan = m.resources.find((r) => r.id === 'hosting.plan')!
  const properties = (plan.attributes as { properties: Record<string, unknown> }).properties
  properties.bandwidthGb = { type: 'number' }
  properties.tagline = { type: 'string' }
  properties.support = { type: 'string' }
  m.capabilities.push({
    id: 'hosting.plan.trial',
    kind: 'action',
    description: 'Try this plan free for two weeks',
    target: 'hosting.plan',
    authorization: { principal: 'authenticated' },
    effects: [
      {
        category: 'state',
        change: 'update',
        resource: 'hosting.plan',
        description: 'Starts the trial',
        reversibility: 'reversible',
      },
    ],
  })
  m.relations!.push({
    type: 'alternativeTo',
    from: 'hosting.plan.trial',
    to: 'hosting.plan.subscribe',
  })
  m.claims!.find((c) => c.id === 'proRecommended')!.cites = ['bandwidthGb']
  return m
}
const up = [{ code: 'us', zones: [{ up: true }] }]
const plans: Record<string, Record<string, unknown>> = {
  hobby: {
    slug: 'hobby',
    priceUsd: 0,
    regions: up,
    bandwidthGb: 100,
    tagline: 'For hobbies',
    support: 'email',
  },
  pro: {
    slug: 'pro',
    priceUsd: 20,
    regions: up,
    bandwidthGb: 400,
    tagline: 'For teams',
    support: 'email',
  },
  team: { slug: 'team', priceUsd: 50, regions: up, bandwidthGb: 1000, support: 'email' },
}
const table = (rows: Record<string, Record<string, unknown>>): ResourceResolver => ({
  load: async (key) => (rows[key] ? { attributes: rows[key] } : null),
  list: async () => Object.keys(rows),
})
const projects = { p1: { id: 'p1', orgId: 'o1', domains: ['a.example'] } }
const runtime = (policies: DiscoveryPolicy[] = [], manifest = manifestOf()) =>
  testRuntime({
    manifest,
    resources: { 'hosting.plan': table(plans), 'hosting.project': table(projects) },
    handlers: { 'hosting.plan.subscribe': { guards: { billing: () => true } } },
    policies,
  })
const member: Principal = { authenticated: true, attributes: { plan: 'hobby', orgIds: ['o1'] } }
const fromProject = { type: 'hosting.project', key: 'p1' }
const fromPro = { type: 'hosting.plan', key: 'pro' }
const DECLARED = ['bandwidthGb', 'priceUsd', 'regions', 'support', 'tagline']
const SUBSCRIBE = 'hosting.plan.subscribe@hosting.plan'
const TRIAL = 'hosting.plan.trial@hosting.plan'

// every column a comparison accounts for: shown, as differing or shared, or cut by name
const columns = (c: Comparison) =>
  [...c.differ, ...Object.keys(c.shared), ...c.omitted.attributes].toSorted()
// every choice set a view carries, shown or summarized, with its comparison
const tables = (v: View) => [
  ...v.choiceSets.map((s) => ({ id: s.id, members: s.members.length, comparison: s.comparison })),
  ...v.omitted.expand
    .filter((e) => e.along === 'members')
    .map((e) => ({ id: e.from as string, members: e.count, comparison: e.comparison! })),
]
const requests: Omit<ProjectionRequest, 'principal'>[] = [
  {},
  { start: fromProject },
  { start: fromPro },
  { start: 'hosting.plan.subscribe' },
  { task: { statement: 'A cheap plan with lots of bandwidth' } },
  { start: fromProject, budget: { offers: 2 } },
  { budget: { offers: 1 } },
]

describe('rule 6: a choice set carries its comparison', () => {
  test('under every built-in policy, every request: every choice set carries every member’s declared attributes', async () => {
    const rt = runtime()
    let seen = 0
    for (const policy of builtInPolicies)
      for (const r of requests) {
        const v = (await rt.project({ principal: member, policy: policy.id, ...r })).view()
        for (const t of tables(v)) {
          seen++
          expect({ policy: policy.id, r, columns: columns(t.comparison) }).toEqual({
            policy: policy.id,
            r,
            columns: DECLARED,
          })
          expect(t.comparison.rows).toHaveLength(t.members)
          expect(t.comparison.omitted.attributes).toEqual([])
        }
      }
    expect(seen).toBeGreaterThan(builtInPolicies.length)
  })

  test('no policy removes it: claims omitted, a narrow scope, or a default budget with a facts limit', async () => {
    const strict: DiscoveryPolicy = {
      id: 'narrow',
      description: 'The start alone, claims omitted, one offer, and a facts limit of its own',
      scope: 'start',
      order: 'canonical',
      claims: 'omitted',
      budget: { offers: 1, facts: 0 },
    }
    const v = (
      await runtime([strict]).project({ principal: member, policy: 'narrow', start: fromPro })
    ).view()
    const all = tables(v)
    expect(all.length).toBeGreaterThan(0)
    // a policy's facts limit never applies: only the request's own does
    for (const t of all)
      expect([columns(t.comparison), t.comparison.omitted.attributes]).toEqual([DECLARED, []])
  })

  test('only a request’s facts cuts it: columns, never rows, each named; what a claim cites or the capability reads stays', async () => {
    const v = (
      await runtime().project({ principal: member, policy: 'exhaustive', budget: { facts: 0 } })
    ).view()
    const byId = new Map(v.choiceSets.map((s) => [s.id, s.comparison]))
    // trial reads nothing and no shown claim on it cites anything: every column is cut, and named
    const trial = byId.get(TRIAL)!
    expect(trial.omitted.attributes.toSorted()).toEqual(DECLARED)
    expect(trial.rows).toHaveLength(3)
    // subscribe: bandwidthGb is cited by proRecommended, priceUsd and regions are read, so none of them is cut
    const subscribe = byId.get(SUBSCRIBE)!
    expect(subscribe.omitted.attributes.toSorted()).toEqual(['support', 'tagline'])
    expect(subscribe.differ).toEqual(['bandwidthGb', 'priceUsd'])
    expect(subscribe.shared).toEqual({ regions: up })
    expect(subscribe.rows.map((r) => r.bandwidthGb)).toEqual([100, 400, 1000])
  })

  // code review of M8 (#9): the exported rule is the one views keep, so the inspector can mark columns by it
  test('keptColumns names exactly what a cut comparison keeps, for every set', async () => {
    const manifest = manifestOf()
    const v = (
      await runtime([], manifest).project({
        principal: member,
        policy: 'exhaustive',
        budget: { facts: 0 },
      })
    ).view()
    const offers = new Map(v.offers.map((o) => [o.id, o]))
    expect(v.choiceSets.length).toBeGreaterThan(1)
    for (const set of v.choiceSets) {
      const { cited, read } = keptColumns(
        manifest.capabilities.find((c) => c.id === set.capability),
        set.members.flatMap((m) => offers.get(m)?.claims ?? []),
      )
      const kept = DECLARED.filter((a) => !set.comparison.omitted.attributes.includes(a))
      expect(kept).toEqual(DECLARED.filter((a) => cited.has(a) || read.has(a)))
    }
  })

  test('a facts limit keeps columns in the runtime’s order, cutting from the end, and an expansion returns the whole table', async () => {
    const rt = runtime()
    // trial's columns in declared order (slug, the key, then priceUsd, regions, and the three added); 3 cells fit
    // priceUsd's three rows, and the next column, regions, doesn't fit, so it and every column after are cut
    const p = await rt.project({ principal: member, policy: 'exhaustive', budget: { facts: 3 } })
    const trial = p.view().choiceSets.find((s) => s.id === TRIAL)!.comparison
    expect([trial.differ, trial.omitted.attributes]).toEqual([
      ['priceUsd'],
      ['regions', 'bandwidthGb', 'tagline', 'support'],
    ])
    const whole = await p.expand({ from: TRIAL, along: 'comparison' }, { budget: { facts: 0 } })
    const full = whole.choiceSets.find((s) => s.id === TRIAL)!.comparison
    expect([columns(full), full.omitted.attributes]).toEqual([DECLARED, []])
  })

  test('an attribute a resolver left out is named as unsupplied, and counted as differing', async () => {
    const v = (await runtime().project({ principal: member, policy: 'exhaustive' })).view()
    const subscribe = v.choiceSets.find((s) => s.id === SUBSCRIBE)!
    expect(subscribe.comparison.unsupplied).toEqual([
      { member: subscribe.members[2], attributes: ['tagline'] },
    ])
    expect(subscribe.comparison.differ).toContain('tagline')
    expect(subscribe.comparison.rows[2]).not.toHaveProperty('tagline')
    expect(subscribe.comparison.shared).toEqual({ regions: up, support: 'email' })
  })

  test('R3: start, task, policy and seen change whether a set appears, never its comparison', async () => {
    const rt = runtime()
    const of = async (r: Omit<ProjectionRequest, 'principal'>) =>
      tables((await rt.project({ principal: member, ...r })).view())
        .filter((t) => t.id === TRIAL)
        .map((t) => canonicalJson(t.comparison))
    const all = (
      await Promise.all([
        of({ policy: 'exhaustive' }),
        of({ policy: 'resource', start: fromPro }),
        of({ policy: 'progressive', task: { statement: 'bandwidth for a busy site' } }),
        of({ policy: 'exhaustive', seen: 'sha256-elsewhere' }),
      ])
    ).flat()
    expect(all.length).toBeGreaterThan(1)
    expect(new Set(all).size).toBe(1)
  })
})

// intake (2026-11-18 12:06Z): what a confirmation summary renders joins the never-cut group, since the person approves
// its words. A generated sweep: summaries over any of the plans' attributes on both capabilities, every built-in
// policy, and every facts budget from 0 up
// a template rendering the chosen attributes, among words and a {{ }} literal, which renders no path
const template = (attrs: string[]) =>
  `Start {{now}}: ${attrs.map((a) => `{target.${a}}`).join(', ')} for {target.slug}`
describe('a confirmation summary’s attributes survive any cut', () => {
  test('for every summarized capability, every policy and every facts budget, its rendered attributes stay', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(DECLARED),
        fc.subarray(DECLARED),
        fc.constantFrom(...builtInPolicies.map((p) => p.id)),
        fc.integer({ min: 0, max: 20 }),
        fc.constantFrom<Omit<ProjectionRequest, 'principal' | 'policy' | 'budget'>>(
          {},
          { start: fromPro },
          { start: fromProject },
        ),
        async (trialAttrs, subscribeAttrs, policy, facts, request) => {
          const m = manifestOf()
          const capability = (id: string) => m.capabilities.find((c) => c.id === id)!
          capability('hosting.plan.trial').confirmation = { summary: template(trialAttrs) }
          capability('hosting.plan.subscribe').confirmation = { summary: template(subscribeAttrs) }
          const rendered: Record<string, string[]> = {
            [TRIAL]: trialAttrs,
            [SUBSCRIBE]: subscribeAttrs,
          }
          const v = (
            await runtime([], m).project({
              principal: member,
              policy,
              budget: { facts },
              ...request,
            })
          ).view()
          for (const t of tables(v)) {
            const kept = [...t.comparison.differ, ...Object.keys(t.comparison.shared)]
            for (const a of rendered[t.id] ?? []) {
              expect(t.comparison.omitted.attributes).not.toContain(a)
              expect(kept).toContain(a)
            }
          }
        },
      ),
      { numRuns: 300, seed: 6612 },
    )
  })

  test('the fixture’s own summary: subscribe renders priceUsd, which no facts limit cuts', async () => {
    const v = (
      await runtime().project({ principal: member, policy: 'exhaustive', budget: { facts: 0 } })
    ).view()
    const subscribe = v.choiceSets.find((s) => s.id === SUBSCRIBE)!.comparison
    expect(subscribe.omitted.attributes).not.toContain('priceUsd')
  })
})
