import { describe, expect, test } from 'vitest'
import type { CapabilityManifest } from '@affordances/ir'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }

import type {
  Budget,
  DiscoveryPolicy,
  Principal,
  Projection,
  ProjectionRequest,
  ResourceResolver,
  View,
} from '../src/index.ts'
import { testRuntime } from './support/runtime.ts'

// the plans fixture, with a trial on each plan that's an alternative to subscribing
const manifestOf = (): CapabilityManifest => {
  const m = structuredClone(plansJson) as unknown as CapabilityManifest
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
  return m
}
type Instances = Record<string, Record<string, unknown>>
const up = [{ code: 'us', zones: [{ up: true }] }]
const plans: Instances = {
  hobby: { slug: 'hobby', priceUsd: 0, regions: up },
  pro: { slug: 'pro', priceUsd: 20, regions: up },
  team: { slug: 'team', priceUsd: 50, regions: up },
}
const projects: Instances = { p1: { id: 'p1', orgId: 'o1', domains: ['a.example'] } }
const table = (rows: Instances): ResourceResolver => ({
  load: async (key) => (rows[key] ? { attributes: rows[key] } : null),
  list: async () => Object.keys(rows),
})
const runtime = (options: { policies?: DiscoveryPolicy[]; defaultPolicy?: string } = {}) =>
  testRuntime({
    manifest: manifestOf(),
    resources: { 'hosting.plan': table(plans), 'hosting.project': table(projects) },
    handlers: { 'hosting.plan.subscribe': { guards: { billing: () => true } } },
    ...options,
  })
const member: Principal = { authenticated: true, attributes: { plan: 'hobby', orgIds: ['o1'] } }
const fromProject = { type: 'hosting.project', key: 'p1' }
const task = { statement: 'Find a plan for my small project; keep costs low, but deploy reliably.' }
// a cursor anyone could write, from its parts
const forge = (body: unknown) => `more:${Buffer.from(JSON.stringify(body)).toString('base64url')}`
const ids = (v: View) => v.offers.map((o) => o.id)

// what each offer's availability is, by id
const availability = (p: Projection) => p.offers.map((o) => [o.id, o.availability])

describe('policies', () => {
  test('resource: the offers on the start, choice sets whole, and the rest one counted expansion away', async () => {
    const p = await runtime().project({ principal: member, start: fromProject })
    const v = p.view()
    expect(v.policy).toBe('resource')
    expect(ids(v)).toEqual([
      'hosting.plan.subscribe@hosting.plan:hobby?project=p1',
      'hosting.plan.subscribe@hosting.plan:pro?project=p1',
      'hosting.plan.subscribe@hosting.plan:team?project=p1',
    ])
    expect(v.choiceSets.map((s) => s.id)).toEqual(['hosting.plan.subscribe@hosting.plan'])
    const rest = p.offers.length - 3
    expect(v.omitted).toMatchObject({ offers: rest, choiceSets: 2, claims: 0 })
    expect(v.omitted.expand).toContainEqual({ from: fromProject, along: 'relations', count: rest })
    const more = await p.expand({ from: fromProject, along: 'relations' })
    expect(new Set([...ids(v), ...ids(more)])).toEqual(new Set(p.offers.map((o) => o.id)))
  })

  test('progressive: the start and one relation step, by relevance to the task, with claims counted and left out', async () => {
    const p = await runtime().project({
      principal: member,
      start: fromProject,
      policy: 'progressive',
      task,
    })
    const v = p.view()
    expect(v.order).toEqual({ by: 'relevance', method: 'basic' })
    // list is related to subscribe, and trial an alternative to it: one step each
    expect(new Set(v.offers.map((o) => o.capability))).toEqual(
      new Set(['hosting.plan.subscribe', 'hosting.plan.list', 'hosting.plan.trial']),
    )
    expect(v.offers.every((o) => o.claims.length === 0)).toBe(true)
    // proRecommended on pro, and proUptime on each of the three subscribe offers
    expect(v.omitted.claims).toBe(4)
    const subscribe = v.offers.find(
      (o) => o.id === 'hosting.plan.subscribe@hosting.plan:pro?project=p1',
    )!
    expect(subscribe.relevance).toEqual({
      level: 'direct',
      basis: [
        { kind: 'start', detail: 'hosting.project:p1' },
        { kind: 'task-text', matched: ['plan', 'project'] },
      ],
    })
    // the direct offers come first, ties in canonical order
    const levels = v.offers.map((o) => (o.relevance as { level: string }).level)
    expect(levels).toEqual(
      levels.toSorted(
        (a, b) =>
          ['direct', 'related', 'unrelated'].indexOf(a) -
          ['direct', 'related', 'unrelated'].indexOf(b),
      ),
    )
    // the projection's own offers keep no relevance: it's the view's
    expect(p.offers.every((o) => o.relevance.level === 'undetermined')).toBe(true)
  })

  test('progressive without a task: relevance is undetermined, not low', async () => {
    const v = (
      await runtime().project({ principal: member, start: fromProject, policy: 'progressive' })
    ).view()
    expect(v.offers.every((o) => o.relevance.level === 'undetermined')).toBe(true)
  })

  test('advocated: what the owner recommends first, the order saying so, and the claims shown', async () => {
    const v = (
      await runtime().project({ principal: member, start: fromProject, policy: 'advocated', task })
    ).view()
    expect(v.order).toEqual({ by: 'claim', kind: 'recommendation', source: 'host' })
    expect(v.offers[0]!.id).toBe('hosting.plan.subscribe@hosting.plan:pro?project=p1')
    expect(v.offers[0]!.claims.map((c) => c.id)).toEqual(['proRecommended', 'proUptime'])
    expect(v.omitted.claims).toBe(0)
  })

  test('the policy changes what is shown, never what is true: one revision, the same offers', async () => {
    const rt = runtime()
    const of = (policy: string) =>
      rt.project({ principal: member, start: fromProject, policy, task })
    const [a, b, c] = await Promise.all([of('exhaustive'), of('progressive'), of('advocated')])
    expect(new Set([a.revision, b.revision, c.revision]).size).toBe(1)
    expect(availability(b)).toEqual(availability(a))
    expect(availability(c)).toEqual(availability(a))
  })

  test('exhaustive is always honored, whatever the default; an unknown policy is refused', async () => {
    const strict: DiscoveryPolicy = {
      id: 'strict',
      description: 'Only the start',
      scope: 'start',
      order: 'canonical',
      claims: 'omitted',
      budget: { offers: 1 },
    }
    const rt = runtime({ policies: [strict], defaultPolicy: 'strict' })
    const p = await rt.project({ principal: member, policy: 'exhaustive' })
    expect(p.view().omitted.offers).toBe(0)
    expect((await rt.project({ principal: member, start: fromProject })).view().policy).toBe(
      'strict',
    )
    await expect(rt.project({ principal: member, policy: 'nope' })).rejects.toThrow(
      'no discovery policy nope',
    )
    expect(() => runtime({ policies: [{ ...strict, id: 'exhaustive' }] })).toThrow(
      'two discovery policies are named exhaustive',
    )
  })
})

describe('budgets', () => {
  test('a choice set that fits is whole, and the rest is the next page', async () => {
    const p = await runtime().project({
      principal: member,
      policy: 'exhaustive',
      budget: { offers: 4 },
    })
    const v = p.view()
    expect(v.offers.length).toBeLessThanOrEqual(4)
    for (const s of p.choiceSets) {
      const shown = s.members.filter((m) => ids(v).includes(m))
      expect([0, s.members.length]).toContain(shown.length)
    }
    const more = v.omitted.expand.find((e) => e.along === 'more')!
    expect(more.count).toBe(p.offers.length - v.offers.length)
    const next = await p.expand(more)
    expect(new Set([...ids(v), ...ids(next)])).toEqual(new Set(p.offers.map((o) => o.id)))
  })

  test('a choice set bigger than the budget is summarized with its count, and expanding it returns all of it', async () => {
    const p = await runtime().project({
      principal: member,
      start: fromProject,
      budget: { offers: 2 },
    })
    const v = p.view()
    expect(v.offers).toEqual([])
    // summarized to its count, and still carrying its comparison, whole: a summary of offers isn't one of facts (§6.6)
    const summarized = v.omitted.expand.find(
      (e) => e.from === 'hosting.plan.subscribe@hosting.plan' && e.along === 'members',
    )
    expect(summarized).toMatchObject({ count: 3, comparison: { omitted: { attributes: [] } } })
    expect(summarized!.comparison!.rows).toHaveLength(3)
    const members = await p.expand(
      { from: 'hosting.plan.subscribe@hosting.plan', along: 'members' },
      { budget: { offers: 1 } },
    )
    expect(ids(members)).toHaveLength(3)
  })
})

describe('expansion and inspection (§6.5)', () => {
  test('a server that projects afresh for each request can follow the first view’s next page', async () => {
    const request = { principal: member, policy: 'exhaustive', budget: { offers: 4 } }
    const more = (await runtime().project(request))
      .view()
      .omitted.expand.find((e) => e.along === 'more')!
    // a new projection, as a stateless route makes, never asked for its view
    const fresh = await runtime().project(request)
    expect(ids(await fresh.expand(more))).toHaveLength(more.count)
    await expect(fresh.expand({ from: 'more:nothing', along: 'more' })).rejects.toThrow(
      'nothing to expand',
    )
  })

  test('a cursor describes itself: a fresh projection follows an expansion page’s, with no replay (simplify C4)', async () => {
    const request = { principal: member, start: fromProject }
    const p = await runtime().project(request)
    // a page of an expansion: the rest of the projection, four offers at a time
    const rest = { from: fromProject, along: 'relations' as const }
    const page = await p.expand(rest, { budget: { offers: 4 } })
    const more = page.omitted.expand.find((e) => e.along === 'more')!
    expect(more.count).toBeGreaterThan(0)
    // a projection that never saw that expansion resolves its cursor all the same
    const fresh = await runtime().project(request)
    const next = await fresh.expand(more)
    expect(next).toEqual(await p.expand(more))
    expect(ids(next)).toHaveLength(more.count)
    // and the same page asked for twice has the same cursor
    expect((await fresh.expand(rest, { budget: { offers: 4 } })).omitted.expand).toEqual(
      page.omitted.expand,
    )
  })

  test('a cursor from another revision is refused, and so is one that isn’t a cursor', async () => {
    const p = await runtime().project({
      principal: member,
      policy: 'exhaustive',
      budget: { offers: 4 },
    })
    const more = p.view().omitted.expand.find((e) => e.along === 'more')!
    // another principal's attributes: another revision
    const other = await runtime().project({
      principal: { ...member, attributes: { ...member.attributes, plan: 'pro' } },
      policy: 'exhaustive',
      budget: { offers: 4 },
    })
    expect(other.revision).not.toBe(p.revision)
    await expect(other.expand(more)).rejects.toThrow('a cursor from another revision')
    await expect(p.expand({ from: 'more:not-a-cursor', along: 'more' })).rejects.toThrow(
      'nothing to expand',
    )
    // a forged cursor of the right revision but the wrong shape is refused the same way, never a TypeError (review of C)
    for (const body of [
      { r: p.revision, o: 5, b: [] },
      { r: p.revision, o: { view: true }, b: [0] },
      { r: p.revision, o: { view: true }, b: [1.5] },
      { r: p.revision, o: { from: 'x', along: 'more' }, b: [] },
      // more cuts than the sequence has offers
      { r: p.revision, o: { view: true }, b: Array.from({ length: p.offers.length + 1 }, () => 1) },
    ])
      await expect(p.expand({ from: forge(body), along: 'more' })).rejects.toThrow(
        'nothing to expand',
      )
  })

  test('two pages that end on the same offer keep their own next pages (review of M3c)', async () => {
    const p = await runtime().project({
      principal: member,
      policy: 'exhaustive',
      budget: { offers: 4 },
    })
    const first = p.view()
    // cancel's three plans and list fit; the rest is the next page
    expect(first.offers.at(-1)!.id).toBe('hosting.plan.list')
    const more = first.omitted.expand.find((e) => e.along === 'more')!
    // another page ending on the same offer: the alternatives of a trial, one at a time
    // a page of another expansion that also ends on list: list is related to subscribe, so it's in their union
    await p.expand(
      { from: 'hosting.plan.subscribe@hosting.plan:pro', along: 'relations' },
      { budget: { offers: 1 } },
    )
    await p.expand(
      { from: 'hosting.plan.subscribe@hosting.plan:pro', along: 'alternatives' },
      { budget: { offers: 1 } },
    )
    const next = await p.expand(more)
    expect(next.offers).toHaveLength(more.count)
    expect(typeof more.from === 'string' && more.from.startsWith('more:')).toBe(true)
    // and asking for the same view again gives the same bytes
    expect(JSON.stringify(p.view())).toBe(JSON.stringify(first))
  })

  test('an offer shown without its alternatives says so, and one expansion returns them all', async () => {
    const strict: DiscoveryPolicy = {
      id: 'subscribeOnly',
      description: 'x',
      scope: 'start',
      order: 'canonical',
      claims: 'shown',
    }
    const p = await runtime({ policies: [strict] }).project({
      principal: member,
      start: 'hosting.plan.subscribe',
      policy: 'subscribeOnly',
    })
    const v = p.view()
    const shown = 'hosting.plan.subscribe@hosting.plan:pro'
    expect(v.offers.find((o) => o.id === shown)!.alternatives).toEqual({ count: 1 })
    expect(v.omitted.expand).toContainEqual({ from: shown, along: 'alternatives', count: 3 })
    expect(ids(await p.expand({ from: shown, along: 'alternatives' }))).toEqual([
      'hosting.plan.trial@hosting.plan:hobby',
      'hosting.plan.trial@hosting.plan:pro',
      'hosting.plan.trial@hosting.plan:team',
    ])
  })

  test('relations from an offer: its declared and derived neighbors', async () => {
    const p = await runtime().project({ principal: member, policy: 'exhaustive' })
    const near = await p.expand({ from: 'hosting.plan.list', along: 'relations' })
    expect(new Set(near.offers.map((o) => o.capability))).toEqual(
      new Set(['hosting.plan.subscribe']),
    )
    await expect(p.expand({ from: 'nothing.here', along: 'relations' })).rejects.toThrow(
      'nothing to expand',
    )
  })

  test('inspect gives the definition and the offer; an id not in the projection is refused', async () => {
    const p = await runtime().project({ principal: member, policy: 'exhaustive' })
    const d = await p.inspect('hosting.plan.cancel@hosting.plan:pro')
    expect(d.definition.id).toBe('hosting.plan.cancel')
    expect(d.offer.id).toBe('hosting.plan.cancel@hosting.plan:pro')
    expect(d.derived).toEqual([])
    await expect(p.inspect('hosting.plan.cancel@hosting.plan:gone')).rejects.toThrow('no offer')
  })

  test('a view is a copy: changing it changes nothing in the projection', async () => {
    const p = await runtime().project({ principal: member, policy: 'exhaustive' })
    const v = p.view()
    v.offers.pop()
    v.offers[0]!.claims = []
    v.choiceSets[0]!.members.pop()
    expect(p.offers).toHaveLength(p.view().offers.length)
    expect(p.view().choiceSets[0]!.members).toHaveLength(3)
  })
})

// §6.3, tested by construction: for every policy, start, budget and task, the view and its expansions reach every
// offer, each shown offer's alternatives are one expansion away, counts are exact, and choice sets are whole
describe('the disclosure invariant', () => {
  const advocatedTight: DiscoveryPolicy = {
    id: 'tight',
    description: 'One offer at a time, claims omitted',
    scope: 'neighborhood',
    depth: 0,
    order: { byClaim: 'recommendation' },
    claims: 'omitted',
    budget: { offers: 1 },
  }
  const requests: ProjectionRequest[] = []
  const starts = [
    undefined,
    fromProject,
    { type: 'hosting.plan', key: 'pro' },
    'hosting.plan.list',
    'hosting.plan',
  ]
  const budgets: (Budget | undefined)[] = [
    undefined,
    { offers: 1 },
    { offers: 3 },
    { offers: 5 },
    { depth: 0 },
  ]
  for (const policy of ['exhaustive', 'resource', 'progressive', 'advocated', 'tight'])
    for (const start of starts)
      for (const budget of budgets)
        for (const t of [undefined, task])
          requests.push({ principal: member, policy, start, budget, task: t } as ProjectionRequest)

  test(`holds for ${requests.length} requests`, async () => {
    const rt = runtime({ policies: [advocatedTight] })
    // each broken promise, with the request it broke for
    const problems: string[] = []
    for (const request of requests) {
      const p = await rt.project(request)
      const all = new Set(p.offers.map((o) => o.id))
      const label = JSON.stringify({ ...request, principal: undefined })
      const fail = (what: string) => problems.push(`${label}: ${what}`)
      const check = (v: View) => {
        for (const s of p.choiceSets) {
          const shown = s.members.filter((m) => ids(v).includes(m)).length
          if (shown !== 0 && shown !== s.members.length) fail(`${s.id} shown in part`)
        }
        if (v.omitted.offers !== all.size - v.offers.length) fail('omitted.offers is inexact')
        // a shown offer whose alternatives aren't all shown says where they are (rule 3)
        for (const o of v.offers) {
          const partner =
            o.capability === 'hosting.plan.trial' ? 'hosting.plan.subscribe' : 'hosting.plan.trial'
          const hidden = p.offers.some(
            (x) => o.alternatives.count > 0 && x.capability === partner && !ids(v).includes(x.id),
          )
          const listed = v.omitted.expand.some((e) => e.from === o.id && e.along === 'alternatives')
          if (hidden && !listed) fail(`${o.id}'s alternatives aren't listed`)
        }
        if (v.omitted.choiceSets !== p.choiceSets.length - v.choiceSets.length)
          fail('omitted.choiceSets is inexact')
      }
      // follow every expansion from the first view, breadth first
      const reached = new Set<string>()
      const queue: View[] = [p.view()]
      const seen = new Set<string>()
      while (queue.length) {
        const v = queue.shift()!
        check(v)
        for (const id of ids(v)) reached.add(id)
        for (const e of v.omitted.expand) {
          const key = JSON.stringify([e.from, e.along])
          if (seen.has(key)) continue
          seen.add(key)
          // without a budget, an expansion returns exactly what its entry counted, whatever was expanded before
          const full = await p.expand(e)
          if (full.offers.length !== e.count)
            fail(`${key} returned ${full.offers.length} of ${e.count}`)
          const next = await p.expand(e, { budget: request.budget })
          // an expansion with something to give shows it, or says where it is
          if (e.count > 0 && next.offers.length + next.omitted.expand.length === 0)
            fail(`${key} gave nothing`)
          queue.push(next)
        }
      }
      for (const id of all) if (!reached.has(id)) fail(`${id} unreachable`)
      // every alternative of every shown offer, one expansion from it
      for (const o of p.view().offers) {
        if (!o.alternatives.count) continue
        const alt = new Set(ids(await p.expand({ from: o.id, along: 'alternatives' })))
        const partners = p.offers.filter((x) =>
          o.capability === 'hosting.plan.trial'
            ? x.capability === 'hosting.plan.subscribe'
            : x.capability === 'hosting.plan.trial',
        )
        for (const x of partners) if (!alt.has(x.id)) fail(`${x.id} isn't one step from ${o.id}`)
      }
    }
    expect(problems).toEqual([])
  }, 60_000)
})
