import { describe, expect, test } from 'vitest'
import type { CapabilityManifest } from '@affordances/ir'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import { createRuntime, offerId, parseOfferId } from '../src/index.ts'
import type { Principal, Projection, ResourceResolver } from '../src/index.ts'

const plans = plansJson as unknown as CapabilityManifest
const fresh = (): CapabilityManifest => structuredClone(plans)

type Instances = Record<string, Record<string, unknown>>
const up = [{ code: 'us', zones: [{ up: true }] }]
const plansState = (): Instances => ({
  hobby: { slug: 'hobby', priceUsd: 0, regions: up },
  pro: { slug: 'pro', priceUsd: 20, regions: up },
  team: { slug: 'team', priceUsd: 50, regions: up },
})
const projectsState = (): Instances => ({ p1: { id: 'p1', orgId: 'o1', domains: ['a.example'] } })
// a resolver over a table of instances, listing its keys in the order given
const table = (rows: Instances, keys = Object.keys(rows)): ResourceResolver => ({
  load: async (key) => (rows[key] ? { attributes: rows[key] } : null),
  list: async () => keys,
})
// a resolver whose instances all have one version
const versioned = (rows: Instances): ResourceResolver => ({
  load: async (key) => (rows[key] ? { attributes: rows[key], version: 'v1' } : null),
  list: async () => Object.keys(rows),
})
const runtimeOf = (
  state = { plans: plansState(), projects: projectsState() },
  manifest = fresh(),
) =>
  createRuntime({
    manifest,
    resources: { 'hosting.plan': table(state.plans), 'hosting.project': table(state.projects) },
  })

const member: Principal = { authenticated: true, attributes: { plan: 'hobby', orgIds: ['o1'] } }
const outsider: Principal = { authenticated: true, attributes: { plan: 'hobby', orgIds: ['o2'] } }
const anonymous: Principal = { authenticated: false, attributes: {} }
const fromProject = { type: 'hosting.project', key: 'p1' }

// everything a projection holds, as bytes: it refuses to serialize itself
const bytes = (p: Projection) =>
  JSON.stringify({
    revision: p.revision,
    offers: p.offers,
    choiceSets: p.choiceSets,
    view: p.view(),
  })

const offer = (offers: { id: string }[], id: string) => {
  const found = offers.find((o) => o.id === id)
  if (!found) throw new Error(`no offer ${id} in ${offers.map((o) => o.id).join(', ')}`)
  return found as (typeof offers)[number] & Record<string, unknown>
}

describe('a projection', () => {
  test('offers each capability on each instance the resolver lists, a global one once, and no event', async () => {
    const p = await runtimeOf().project({ principal: member })
    expect(p.offers.map((o) => o.id)).toEqual([
      'hosting.plan.cancel@hosting.plan:hobby',
      'hosting.plan.cancel@hosting.plan:pro',
      'hosting.plan.cancel@hosting.plan:team',
      'hosting.plan.list',
      'hosting.plan.subscribe@hosting.plan:hobby',
      'hosting.plan.subscribe@hosting.plan:pro',
      'hosting.plan.subscribe@hosting.plan:team',
    ])
    // plans are alternatives, so each capability on them is a choice set of every listed plan
    expect(p.choiceSets.map((s) => [s.id, s.members.length])).toEqual([
      ['hosting.plan.cancel@hosting.plan', 3],
      ['hosting.plan.subscribe@hosting.plan', 3],
    ])
  })

  test('binds a reference from the start instance, which the offer id and its context carry', async () => {
    const p = await runtimeOf().project({ principal: member, start: fromProject })
    const o = offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro?project=p1')
    expect(o.with).toEqual({ project: 'p1' })
    // the declarative conditions read the project; the guard waits for M3b, and seats are input
    expect(
      Object.fromEntries(
        (o.conditions as { id: string; value: unknown }[]).map((c) => [c.id, c.value]),
      ),
    ).toEqual({
      member: true,
      notCurrent: true,
      hasDomain: true,
      regionUp: true,
      seatsInRange: 'unknown',
      billing: 'unknown',
    })
    expect(o.requirements).toEqual({
      authorization: 'met',
      confirmation: { summary: 'Subscribe to pro for 20 USD a month' },
    })
  })

  test('the same manifest gives different graphs to different principals', async () => {
    const rt = runtimeOf()
    const status = async (principal: Principal) => {
      const p = await rt.project({ principal, start: fromProject })
      return offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro?project=p1').availability
    }
    expect(await status(anonymous)).toEqual({ status: 'needs-authorization' })
    expect(await status(outsider)).toEqual({ status: 'unavailable', because: ['member'] })
    expect(await status(member)).toEqual({
      status: 'unknown',
      because: ['seatsInRange', 'billing'],
    })
    // and the plan the member is on can't be chosen again
    const p = await rt.project({ principal: member, start: fromProject })
    expect(
      offer(p.offers, 'hosting.plan.subscribe@hosting.plan:hobby?project=p1').availability,
    ).toEqual({
      status: 'unavailable',
      because: ['notCurrent'],
    })
  })

  test('the same manifest gives different graphs in different states', async () => {
    const before = await runtimeOf().project({ principal: member, start: fromProject })
    const state = { plans: plansState(), projects: projectsState() }
    state.projects.p1!.domains = []
    delete state.plans.team
    const after = await runtimeOf(state).project({ principal: member, start: fromProject })
    expect(
      offer(after.offers, 'hosting.plan.subscribe@hosting.plan:pro?project=p1').availability,
    ).toEqual({
      status: 'unavailable',
      because: ['hasDomain'],
    })
    // the resolver no longer returns team, so it's no member of the choice set
    expect(
      after.choiceSets.find((s) => s.capability === 'hosting.plan.subscribe')!.members,
    ).toEqual([
      'hosting.plan.subscribe@hosting.plan:hobby?project=p1',
      'hosting.plan.subscribe@hosting.plan:pro?project=p1',
    ])
    expect(after.revision).not.toBe(before.revision)
  })

  test('without a task or a policy, relevance is undetermined and the view is everything, nothing omitted', async () => {
    const p = await runtimeOf().project({ principal: member })
    expect(p.offers.every((o) => o.relevance.level === 'undetermined')).toBe(true)
    const view = p.view()
    expect(view).toMatchObject({
      revision: p.revision,
      policy: 'exhaustive',
      order: { by: 'canonical' },
      omitted: { offers: 0, choiceSets: 0, claims: 0, expand: [] },
    })
    expect(view.offers).toEqual(p.offers)
    expect(view.stale).toBeUndefined()
    expect(
      (await runtimeOf().project({ principal: member, seen: 'sha256-old' })).view().stale,
    ).toBe(true)
    expect(
      (await runtimeOf().project({ principal: member, seen: p.revision })).view().stale,
    ).toBeUndefined()
  })
})

test('a projection refuses to be serialized, and its view serializes: only views go on a wire', async () => {
  const p = await runtimeOf().project({ principal: member })
  expect(() => JSON.stringify(p)).toThrow('a projection is runtime-internal')
  expect(() => JSON.stringify({ result: p })).toThrow('a projection is runtime-internal')
  expect(JSON.parse(JSON.stringify(p.view())).offers).toHaveLength(p.offers.length)
})

describe('deterministic for its input', () => {
  test('the same input twice gives the same projection, whatever order the resolver lists in', async () => {
    const state = { plans: plansState(), projects: projectsState() }
    const a = await runtimeOf(state).project({ principal: member, start: fromProject })
    const b = await runtimeOf(state).project({ principal: member, start: fromProject })
    const reversed = await createRuntime({
      manifest: fresh(),
      resources: {
        'hosting.plan': table(state.plans, ['team', 'pro', 'hobby']),
        'hosting.project': table(state.projects),
      },
    }).project({ principal: member, start: fromProject })
    expect(bytes(b)).toBe(bytes(a))
    expect(bytes(reversed)).toBe(bytes(a))
  })

  test('an attribute the manifest doesn’t declare changes nothing, not even the revision', async () => {
    const a = await runtimeOf().project({ principal: member })
    const b = await runtimeOf().project({
      principal: { ...member, subject: 'u_1', attributes: { ...member.attributes, extra: 1 } },
    })
    expect(bytes(b)).toBe(bytes(a))
  })

  test('an offer’s revision moves with its own instances, the projection’s with any', async () => {
    const a = await runtimeOf().project({ principal: member })
    const state = { plans: plansState(), projects: projectsState() }
    state.plans.team!.priceUsd = 60
    const b = await runtimeOf(state).project({ principal: member })
    const rev = (p: typeof a, id: string) => offer(p.offers, id).revision
    expect(rev(b, 'hosting.plan.subscribe@hosting.plan:pro')).toBe(
      rev(a, 'hosting.plan.subscribe@hosting.plan:pro'),
    )
    expect(rev(b, 'hosting.plan.subscribe@hosting.plan:team')).not.toBe(
      rev(a, 'hosting.plan.subscribe@hosting.plan:team'),
    )
    expect(b.revision).not.toBe(a.revision)
    // and a principal's declared attribute is an input of both
    const c = await runtimeOf().project({
      principal: { ...member, attributes: { ...member.attributes, plan: 'pro' } },
    })
    expect(rev(c, 'hosting.plan.subscribe@hosting.plan:team')).not.toBe(
      rev(a, 'hosting.plan.subscribe@hosting.plan:team'),
    )
    expect(c.revision).not.toBe(a.revision)
  })

  test('a resolver’s version stands for the instance, so attributes it covers don’t move the revision', async () => {
    const changed = plansState()
    changed.pro!.priceUsd = 25
    const [a, b] = await Promise.all(
      [changed, plansState()].map((rows) =>
        createRuntime({
          manifest: fresh(),
          resources: { 'hosting.plan': versioned(rows), 'hosting.project': table(projectsState()) },
        }).project({ principal: member }),
      ),
    )
    expect(a!.revision).toBe(b!.revision)
  })
})

describe('what an offer says', () => {
  test('claims about its capability whose applies isn’t false, each with its source and basis', async () => {
    const p = await runtimeOf().project({ principal: member })
    const claims = (id: string) => (offer(p.offers, id).claims as { id: string }[]).map((c) => c.id)
    expect(claims('hosting.plan.subscribe@hosting.plan:pro')).toEqual([
      'proRecommended',
      'proUptime',
    ])
    expect(claims('hosting.plan.subscribe@hosting.plan:hobby')).toEqual(['proUptime'])
    expect(offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro').claims).toContainEqual({
      id: 'proUptime',
      kind: 'assessment',
      statement: 'Monthly uptime on Pro',
      quantity: { value: 99.9, unit: 'percent' },
      source: { id: 'monitor', name: 'Example Uptime Monitor', role: 'third-party' },
      basis: 'verified',
    })
  })

  test('consequential is derived from effects, and an action with none declared is consequential', async () => {
    const p = await runtimeOf().project({ principal: member })
    expect(offer(p.offers, 'hosting.plan.list').consequential).toBe(false)
    expect(offer(p.offers, 'hosting.plan.cancel@hosting.plan:pro').consequential).toBe(true)
    // subscribe declares no effects: unknown, so consequential
    expect(offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro').consequential).toBe(true)
  })

  test('no declared authorization is unknown, never available', async () => {
    const p = await runtimeOf().project({ principal: member })
    expect(offer(p.offers, 'hosting.plan.list')).toMatchObject({
      requirements: { authorization: 'none-declared' },
      availability: { status: 'unknown', because: ['authorization'] },
    })
  })

  test('a condition left only on the input is needs-input, naming those paths', async () => {
    const manifest = fresh()
    const subscribe = manifest.capabilities[1]!
    subscribe.preconditions = subscribe.preconditions!.filter((c) => c.id !== 'billing')
    const p = await runtimeOf(undefined, manifest).project({
      principal: member,
      start: fromProject,
    })
    expect(
      offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro?project=p1').availability,
    ).toEqual({
      status: 'needs-input',
      inputs: ['input.seats'],
    })
  })

  test('a resolver that throws makes what it would have supplied unknown, never a guess', async () => {
    const p = await createRuntime({
      manifest: fresh(),
      resources: {
        'hosting.plan': table(plansState()),
        'hosting.project': {
          load: async () => {
            throw new Error('down')
          },
        },
      },
    }).project({ principal: member, start: fromProject })
    const o = offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro?project=p1')
    expect(o.availability).toEqual({
      status: 'unknown',
      because: ['member', 'hasDomain', 'seatsInRange', 'billing'],
    })
  })

  test('an instance its resolver returns null for has no offer', async () => {
    const p = await createRuntime({
      manifest: fresh(),
      resources: {
        'hosting.plan': table(plansState(), ['hobby', 'gone']),
        'hosting.project': table({}),
      },
    }).project({ principal: member, start: fromProject })
    expect(p.offers.map((o) => o.id)).toEqual([
      'hosting.plan.cancel@hosting.plan:hobby',
      'hosting.plan.list',
      'hosting.plan.subscribe@hosting.plan:hobby',
    ])
  })
})

describe('offer ids', () => {
  test('are canonical, percent-encode keys, and read back', () => {
    const parts = {
      capability: 'a.b',
      target: { type: 'x.y', key: 'k/1 é' },
      with: { z: '2', a: '1&=' },
    }
    const id = offerId(parts)
    expect(id).toBe('a.b@x.y:k%2F1%20%C3%A9?a=1%26%3D&z=2')
    expect(parseOfferId(id)).toEqual(parts)
    expect(parseOfferId('a.b')).toEqual({ capability: 'a.b' })
  })
  test.for(['', 'A.b', 'a.b@x.y', 'a.b?z=2&a=1', 'a.b@x.y:%E0', 'a.b@x.y:k?=1', 'a.b@x.y:k 1'])(
    'refuses %j, which isn’t one, or isn’t canonical',
    (id) => {
      expect(parseOfferId(id)).toBeUndefined()
    },
  )
})

describe('createRuntime', () => {
  test('refuses an invalid manifest, and a resource type with no resolver', () => {
    const invalid = fresh()
    invalid.capabilities[1]!.target = 'hosting.nothing'
    expect(() => runtimeOf(undefined, invalid)).toThrow(/E_UNRESOLVED/)
    expect(() =>
      createRuntime({ manifest: fresh(), resources: { 'hosting.plan': table({}) } }),
    ).toThrow('no resolver for the resource type hosting.project')
  })
})
