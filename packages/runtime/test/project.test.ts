import { describe, expect, test } from 'vitest'
import type { CapabilityManifest } from '@affordances/ir'
import plansJson from '../../ir/fixtures/valid/plans.json' with { type: 'json' }
import { createRuntime, offerId, parseOfferId } from '../src/index.ts'
import { testRuntime } from './support/runtime.ts'
import type { GuardImpl, Principal, Projection, ResourceResolver } from '../src/index.ts'

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
// the fixture's one guard, billing on subscribe: not ruled out, unless a test says otherwise
const handlers = (billing: GuardImpl = () => true) => ({
  'hosting.plan.subscribe': { guards: { billing } },
})
// each load and list waits a random while, so the order they settle in changes from run to run
const slow = (rows: Instances): ResourceResolver => ({
  load: async (key) => {
    await new Promise((r) => setTimeout(r, Math.random() * 5))
    return rows[key] ? { attributes: rows[key] } : null
  },
  list: async () => {
    await new Promise((r) => setTimeout(r, Math.random() * 5))
    return Object.keys(rows)
  },
})

const runtimeOf = (
  state = { plans: plansState(), projects: projectsState() },
  manifest = fresh(),
  billing?: GuardImpl,
) =>
  testRuntime({
    manifest,
    resources: { 'hosting.plan': table(state.plans), 'hosting.project': table(state.projects) },
    handlers: handlers(billing),
  })

// one projection, from the start, over resolvers that answer in a random order, as bytes
const shuffledBytes = async () => {
  const p = await testRuntime({
    manifest: fresh(),
    resources: { 'hosting.plan': slow(plansState()), 'hosting.project': slow(projectsState()) },
    handlers: handlers(),
  }).project({ principal: member, start: fromProject, policy: 'exhaustive' })
  return bytes(p)
}

const member: Principal = { authenticated: true, attributes: { plan: 'hobby', orgIds: ['o1'] } }
const outsider: Principal = { authenticated: true, attributes: { plan: 'hobby', orgIds: ['o2'] } }
const anonymous: Principal = { authenticated: false, attributes: {} }
const fromProject = { type: 'hosting.project', key: 'p1' }
const SUBSCRIBE_ID = 'hosting.plan.subscribe'

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
      confirmation: {
        summary: 'Subscribe to pro for 20 USD a month. Charges: 20 USD a month, until undone',
      },
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
    // what's left is the input: the seats, and billing, which a guard can only rule out once it has the input
    expect(await status(member)).toEqual({ status: 'needs-input', inputs: ['input.seats'] })
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

  test('without a task, relevance is undetermined, and the exhaustive view is everything, nothing omitted', async () => {
    const p = await runtimeOf().project({ principal: member, policy: 'exhaustive' })
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
      (
        await runtimeOf().project({ principal: member, policy: 'exhaustive', seen: 'sha256-old' })
      ).view().stale,
    ).toBe(true)
    expect(
      (
        await runtimeOf().project({ principal: member, policy: 'exhaustive', seen: p.revision })
      ).view().stale,
    ).toBeUndefined()
  })
})

test('a projection refuses to be serialized, and its view serializes: only views go on a wire', async () => {
  const p = await runtimeOf().project({ principal: member, policy: 'exhaustive' })
  expect(() => JSON.stringify(p)).toThrow('a projection is runtime-internal')
  expect(() => JSON.stringify({ result: p })).toThrow('a projection is runtime-internal')
  expect(JSON.parse(JSON.stringify(p.view())).offers).toHaveLength(p.offers.length)
})

describe('deterministic for its input', () => {
  test('the same input twice gives the same projection, whatever order the resolver lists in', async () => {
    const state = { plans: plansState(), projects: projectsState() }
    const a = await runtimeOf(state).project({ principal: member, start: fromProject })
    const b = await runtimeOf(state).project({ principal: member, start: fromProject })
    const reversed = await testRuntime({
      manifest: fresh(),
      handlers: handlers(),
      resources: {
        'hosting.plan': table(state.plans, ['team', 'pro', 'hobby']),
        'hosting.project': table(state.projects),
      },
    }).project({ principal: member, start: fromProject })
    expect(bytes(b)).toBe(bytes(a))
    expect(bytes(reversed)).toBe(bytes(a))
  })

  test('resolvers answering in any order give the same bytes: projection calls them concurrently (simplify D6)', async () => {
    const first = await shuffledBytes()
    for (let i = 0; i < 5; i++) expect(await shuffledBytes()).toBe(first)
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
        testRuntime({
          manifest: fresh(),
          handlers: handlers(),
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

  test('a claim whose subject names the capability with the manifest’s namespace is shown too', async () => {
    const manifest = fresh()
    manifest.claims![1]!.subject = `${manifest.namespace}#hosting.plan.subscribe`
    const p = await runtimeOf(undefined, manifest).project({ principal: member })
    expect(
      (offer(p.offers, 'hosting.plan.subscribe@hosting.plan:hobby').claims as { id: string }[]).map(
        (c) => c.id,
      ),
    ).toEqual(['proUptime'])
  })

  test('an alternativeTo written with the manifest’s namespace counts, both ways (found by the generated test)', async () => {
    const manifest = fresh()
    manifest.relations!.push({
      type: 'alternativeTo',
      from: `${manifest.namespace}#hosting.plan.cancel`,
      to: 'hosting.plan.subscribe',
    })
    const p = await runtimeOf(undefined, manifest).project({ principal: member })
    expect(offer(p.offers, 'hosting.plan.cancel@hosting.plan:pro').alternatives).toEqual({
      count: 1,
    })
    expect(offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro').alternatives).toEqual({
      count: 1,
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

  test('needs-input only when every missing path is on the input', async () => {
    // review's case: the input against an attribute the resolver didn't supply
    const manifest = fresh()
    const project = manifest.resources[1]!.attributes as { properties: Record<string, unknown> }
    project.properties.seatLimit = { type: 'integer' }
    manifest.capabilities[1]!.preconditions!.push({
      id: 'underLimit',
      description: 'No more seats than the project allows',
      expr: { le: [{ count: 'input.seats' }, { path: 'project.seatLimit' }] },
    })
    const status = async (projects: Instances) =>
      offer(
        (
          await runtimeOf({ plans: plansState(), projects }, manifest).project({
            principal: member,
            start: fromProject,
          })
        ).offers,
        'hosting.plan.subscribe@hosting.plan:pro?project=p1',
      ).availability
    // seatLimit isn't supplied, so the comparison waits on more than input
    expect(await status(projectsState())).toEqual({
      status: 'unknown',
      because: ['seatsInRange', 'billing', 'underLimit'],
    })
    const limited = projectsState()
    limited.p1!.seatLimit = 10
    expect(await status(limited)).toEqual({ status: 'needs-input', inputs: ['input.seats'] })
  })

  test('a resolver that throws makes what it would have supplied unknown, never a guess', async () => {
    const p = await testRuntime({
      manifest: fresh(),
      handlers: handlers(),
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
    const p = await testRuntime({
      manifest: fresh(),
      handlers: handlers(),
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

// for the guard tests: subscribe to pro from p1 with a billing guard, under a manifest
const subscribePro = async (billing: GuardImpl, manifest = fresh()) =>
  offer(
    (
      await runtimeOf(undefined, manifest, billing).project({
        principal: member,
        start: fromProject,
      })
    ).offers,
    'hosting.plan.subscribe@hosting.plan:pro?project=p1',
  )
const billingOf = (o: Record<string, unknown>) =>
  (o.conditions as { id: string }[]).find((c) => c.id === 'billing')
const projectWith = (billing: GuardImpl) =>
  runtimeOf(undefined, fresh(), billing).project({ principal: member })
const only = (value: boolean) => Object.assign(() => value, { executionOnly: true as const })

describe('guards at projection time (§4.2)', () => {
  test('run with no input, the target and the bound references', async () => {
    const calls: unknown[] = []
    await subscribePro((args) => (calls.push(args), true))
    expect(calls).toContainEqual({
      input: undefined,
      target: { key: 'pro', attributes: plansState().pro },
      refs: { project: { key: 'p1', attributes: projectsState().p1 } },
      principal: member,
    })
  })

  test('false rules it out, and a string rules it out and says why', async () => {
    expect((await subscribePro(() => false)).availability).toEqual({
      status: 'unavailable',
      because: ['billing'],
    })
    const o = await subscribePro(async () => 'the card on file has expired')
    expect(o.availability).toEqual({ status: 'unavailable', because: ['billing'] })
    expect(billingOf(o)).toEqual({
      id: 'billing',
      description: 'The billing account is in good standing',
      value: false,
      detail: 'the card on file has expired',
    })
  })

  test('a guard that throws, or returns neither a boolean nor a string, is unknown, never a guess', async () => {
    for (const billing of [
      () => {
        throw new Error('down')
      },
      () => 1 as never,
    ])
      expect((await subscribePro(billing)).availability).toEqual({
        status: 'unknown',
        because: ['seatsInRange', 'billing'],
      })
  })

  test('an execution-only guard isn’t run, and stays unknown', async () => {
    let ran = 0
    const billing: GuardImpl = Object.assign(() => (ran++, false), { executionOnly: true as const })
    expect((await subscribePro(billing)).availability).toEqual({
      status: 'unknown',
      because: ['seatsInRange', 'billing'],
    })
    expect(ran).toBe(0)
  })

  test('true on a capability that takes no input is true', async () => {
    const manifest = fresh()
    manifest.capabilities[2]!.preconditions = [
      { id: 'active', description: 'The plan is active on the account', guard: true },
    ]
    const p = await testRuntime({
      manifest,
      resources: { 'hosting.plan': table(plansState()), 'hosting.project': table({}) },
      handlers: {
        ...handlers(),
        'hosting.plan.cancel': { guards: { active: ({ target }) => target?.key === 'pro' } },
      },
    }).project({ principal: member })
    expect(offer(p.offers, 'hosting.plan.cancel@hosting.plan:pro').availability).toEqual({
      status: 'available',
    })
    expect(offer(p.offers, 'hosting.plan.cancel@hosting.plan:hobby').availability).toEqual({
      status: 'unavailable',
      because: ['active'],
    })
  })

  test('what a guard says is an input of both revisions, and an execution-only guard isn’t', async () => {
    const [yes, no, why] = await Promise.all([
      projectWith(() => true),
      projectWith(() => false),
      projectWith(() => 'expired'),
    ])
    const rev = (p: Projection) =>
      offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro').revision
    expect(new Set([rev(yes), rev(no), rev(why)]).size).toBe(3)
    expect(new Set([yes.revision, no.revision, why.revision]).size).toBe(3)
    // cancel has no guard, so its revision doesn't move
    expect(offer(no.offers, 'hosting.plan.cancel@hosting.plan:pro').revision).toBe(
      offer(yes.offers, 'hosting.plan.cancel@hosting.plan:pro').revision,
    )
    const [a, b] = await Promise.all([projectWith(only(true)), projectWith(only(false))])
    expect(b.revision).toBe(a.revision)
  })

  test('an authorization guard never waits on the input: true is met, with or without input', async () => {
    const manifest = fresh()
    manifest.capabilities[1]!.authorization!.conditions = [
      { id: 'billingOwner', description: 'The caller owns the billing account', guard: true },
    ]
    const p = await testRuntime({
      manifest,
      resources: { 'hosting.plan': table(plansState()), 'hosting.project': table(projectsState()) },
      handlers: {
        'hosting.plan.subscribe': { guards: { billing: () => true, billingOwner: () => true } },
      },
    }).project({ principal: member, start: fromProject })
    const o = offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro?project=p1')
    expect((o.requirements as { authorization: string }).authorization).toBe('met')
    expect(o.availability).toEqual({ status: 'needs-input', inputs: ['input.seats'] })
  })

  test('createRuntime refuses to start without an implementation for every declared guard', () => {
    expect(() =>
      testRuntime({
        manifest: fresh(),
        resources: { 'hosting.plan': table({}), 'hosting.project': table({}) },
      }),
    ).toThrow("no implementation for hosting.plan.subscribe's guard billing")
  })
})

describe('the M3 close-out code review', () => {
  test('8: an input the runtime fills itself isn’t one the caller owes: such a capability can be available', async () => {
    // cancel takes only the plan's id, which targetAt fills from the offer, and a guard that passes
    const manifest = fresh()
    const cancel = manifest.capabilities[2]!
    cancel.input = {
      type: 'object',
      properties: { planId: { type: 'string' } },
      required: ['planId'],
    }
    cancel.targetAt = '/planId'
    cancel.preconditions = [
      { id: 'active', description: 'The plan is active on the account', guard: true },
    ]
    // and subscribe, whose project reference is bound from the start, still owes its seats
    const p = await testRuntime({
      manifest,
      resources: { 'hosting.plan': table(plansState()), 'hosting.project': table(projectsState()) },
      handlers: { ...handlers(), 'hosting.plan.cancel': { guards: { active: () => true } } },
    }).project({ principal: member, start: fromProject })
    expect(offer(p.offers, 'hosting.plan.cancel@hosting.plan:pro').availability).toEqual({
      status: 'available',
    })
    expect(
      offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro?project=p1').availability,
    ).toEqual({
      status: 'needs-input',
      inputs: ['input.seats'],
    })
  })

  // a value that isn't I-JSON, or isn't plain data, is no attribute: that instance's attributes are unknown (§2.1)
  class Money {
    constructor(readonly cents: number) {}
  }
  test.for([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a BigInt', 20n],
    ['undefined in an array', [undefined]],
    ['a Date', new Date('2026-11-17')],
    ['a class instance', new Money(2000)],
    ['the wrong type for its schema', 'twenty'],
  ] as const)(
    '7: %s in an attribute makes that instance unknown, and never a throw',
    async ([, value]) => {
      const state = { plans: plansState(), projects: projectsState() }
      state.plans.pro!.priceUsd = value
      const p = await runtimeOf(state).project({ principal: member, start: fromProject })
      // pro's conditions on its own attributes can't be read; hobby is untouched
      const pro = offer(p.offers, 'hosting.plan.subscribe@hosting.plan:pro?project=p1')
      expect(
        (pro.conditions as { id: string; value: unknown }[]).find((c) => c.id === 'regionUp')!
          .value,
      ).toBe('unknown')
      expect(
        offer(p.offers, 'hosting.plan.subscribe@hosting.plan:hobby?project=p1').availability,
      ).toMatchObject({
        status: 'unavailable',
      })
      expect(p.revision).toMatch(/^sha256-/)
    },
  )
})

// only the subscribe offers are in scope; bind gives them the project, as starting from it would
const subscribeWith = (bind?: { type: string; key: string }[]) =>
  runtimeOf().project({
    principal: member,
    start: SUBSCRIBE_ID,
    policy: 'resource',
    bind,
  } as never)

describe('bind: references bound from the request, never a wider scope (§2)', () => {
  test('it binds the reference wherever the type matches, and adds no offer: the view is the scope’s', async () => {
    const p = await subscribeWith([fromProject])
    const v = p.view()
    expect(v.offers.map((o) => o.id)).toEqual([
      'hosting.plan.subscribe@hosting.plan:hobby?project=p1',
      'hosting.plan.subscribe@hosting.plan:pro?project=p1',
      'hosting.plan.subscribe@hosting.plan:team?project=p1',
    ])
    // without bind, the same scope: the same offers, unbound
    expect((await subscribeWith()).view().offers.map((o) => o.id)).toEqual([
      'hosting.plan.subscribe@hosting.plan:hobby',
      'hosting.plan.subscribe@hosting.plan:pro',
      'hosting.plan.subscribe@hosting.plan:team',
    ])
  })
  test('availability is what binding the reference implies: the same as starting from the project', async () => {
    const bound = await subscribeWith([fromProject])
    const started = await runtimeOf().project({
      principal: member,
      start: fromProject,
      policy: 'exhaustive',
    })
    for (const o of bound.offers.filter((x) => x.capability === SUBSCRIBE_ID))
      expect(o.availability).toEqual(offer(started.offers, o.id).availability)
  })
  test('two instances of one type bind neither, whatever their order (design’s check)', async () => {
    const two = [fromProject, { type: 'hosting.project', key: 'p2' }]
    const [ab, ba] = await Promise.all([subscribeWith(two), subscribeWith(two.toReversed())])
    expect(ab.view().offers.every((o) => o.with === undefined)).toBe(true)
    expect(bytes(ba)).toBe(bytes(ab))
  })
  test('the start binds first: a type the start binds keeps the start’s instance', async () => {
    const p = await runtimeOf().project({
      principal: member,
      start: fromProject,
      policy: 'exhaustive',
      bind: [{ type: 'hosting.project', key: 'p2' }],
    })
    expect(p.offers.filter((o) => o.with).every((o) => o.with!.project === 'p1')).toBe(true)
  })
  test('an instance that doesn’t exist and one the principal can’t see bind alike: byte-equal responses', async () => {
    // p2 exists, and belongs to someone else: this resolver hides it from the member, as a real app would
    const hiding: ResourceResolver = {
      load: async (key, principal) =>
        key === 'p2'
          ? principal.subject === 'u2'
            ? { attributes: { id: 'p2', orgId: 'o2', domains: [] } }
            : null
          : null,
    }
    const project = (key: string) =>
      testRuntime({
        manifest: fresh(),
        resources: { 'hosting.plan': table(plansState()), 'hosting.project': hiding },
        handlers: handlers(),
      }).project({
        principal: member,
        start: SUBSCRIBE_ID,
        policy: 'resource',
        bind: [{ type: 'hosting.project', key }],
      } as never)
    const [missing, notYours] = await Promise.all([project('p9'), project('p2')])
    expect(bytes(notYours)).toBe(bytes(missing))
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
  test('refuses a query or action no handler runs, and a confirmation with no keys or token store (§11)', () => {
    const resources = { 'hosting.plan': table({}), 'hosting.project': table({}) }
    const guards = {
      'hosting.plan.subscribe': { guards: { billing: () => true }, run: () => undefined },
    }
    expect(() => createRuntime({ manifest: fresh(), resources, handlers: guards })).toThrow(
      'no handler runs hosting.plan.list',
    )
    const runs = {
      ...guards,
      'hosting.plan.list': { run: () => [] },
      'hosting.plan.cancel': { run: () => undefined },
    }
    expect(() => createRuntime({ manifest: fresh(), resources, handlers: runs })).toThrow(
      'hosting.plan.subscribe requires confirmation: give createRuntime approvalKeys and seenTokens',
    )
  })

  test('refuses an invalid manifest, and a resource type with no resolver', () => {
    const invalid = fresh()
    invalid.capabilities[1]!.target = 'hosting.nothing'
    expect(() => runtimeOf(undefined, invalid)).toThrow(/E_UNRESOLVED/)
    expect(() =>
      testRuntime({ manifest: fresh(), resources: { 'hosting.plan': table({}) } }),
    ).toThrow('no resolver for the resource type hosting.project')
  })
})
