import { beforeEach, expect, test } from 'vitest'
import { POLICIES, inspect } from '../src/lib/inspect.ts'
import { runtimeFor } from '../src/lib/runtime.ts'
import { manifest } from '../src/app/capabilities.ts'
import { principalFor, resolvers } from '../src/lib/resolvers.ts'
import * as store from '../src/lib/store.ts'
import { TASK_EDITS } from '../src/lib/task-edits.ts'

// the inspector's data, over the real manifest, store and runtime (M3f)

beforeEach(() => store.reset())

const sid = 's_inspect'

test('a projection for a signed-in owner offers subscribing on every plan, as one choice set', async () => {
  const i = await inspect(principalFor(sid))
  const subscribe = i.offers.filter((o) => o.capability === 'hosting.plan.subscribe')
  expect(subscribe.map((o) => o.target)).toEqual([
    { type: 'hosting.plan', key: 'p1' },
    { type: 'hosting.plan', key: 'p2' },
    { type: 'hosting.plan', key: 'p3' },
  ])
  const set = i.choiceSets.find((c) => c.capability === 'hosting.plan.subscribe')!
  expect(set.members).toEqual(subscribe.map((o) => o.id))
  // the owner's recommendation reaches the Pro offer only, attributed to the owner
  const pro = subscribe.find((o) => o.target?.key === 'p2')!
  expect(pro.claims.map((c) => [c.id, c.source.role])).toEqual(
    expect.arrayContaining([['proRecommended', 'owner']]),
  )
  expect(subscribe.find((o) => o.target?.key === 'p1')!.claims.map((c) => c.id)).not.toContain(
    'proRecommended',
  )
})

test("every offer is marked as in the policy's view or not, and the exhaustive view leaves nothing out", async () => {
  const i = await inspect(principalFor(sid))
  expect(i.offers.length).toBeGreaterThan(0)
  expect(i.offers.every((o) => o.inView)).toBe(true)
  expect(i.omitted.offers).toBe(0)
})

test('without a session, the project is not visible, and authenticated capabilities need authorization', async () => {
  const i = await inspect(principalFor(null))
  expect(i.offers.some((o) => o.target?.type === 'hosting.project')).toBe(false)
  const subscribe = i.offers.find((o) => o.capability === 'hosting.plan.subscribe')!
  expect(subscribe.availability.status).toBe('needs-authorization')
})

test('the definitions include declared and derived relations, every derived one inferred', async () => {
  const i = await inspect(principalFor(sid))
  expect(i.definitions.relations).toEqual([
    expect.objectContaining({ type: 'alternativeTo', from: 'hosting.bundle.subscribe' }),
  ])
  expect(i.definitions.derived.length).toBeGreaterThan(0)
  expect(i.definitions.derived.every((e) => e.basis === 'inferred')).toBe(true)
})

test('resolvers show a caller only their own project and deployments', async () => {
  const mine = store.account(sid).project.id
  store.deploy(store.account(sid).id, mine, 'main')
  const other = principalFor('s_other')
  expect(await resolvers['hosting.project']!.load(mine, other)).toBeNull()
  expect(await resolvers['hosting.deployment']!.list!(other, { capability: 'x' })).toEqual([])
  expect(
    await resolvers['hosting.deployment']!.list!(principalFor(sid), { capability: 'x' }),
  ).toEqual(['dep_1'])
})

test("what depends only on the manifest is made once, and each request projects only the caller's view", async () => {
  store.account('s_once')
  const first = await inspect(principalFor('s_once'))
  const second = await inspect(principalFor('s_once'), { policy: 'resource' })
  // the same definitions object, derived edges included, for every request on a manifest
  expect(second.definitions).toBe(first.definitions)
  expect(runtimeFor(manifest)).toBe(runtimeFor(manifest))
  // and the caller's part is fresh: the policy shapes the view, while the projection's offers are the same
  expect(second.policy).toBe('resource')
  expect(second.offers.map((o) => o.id)).toEqual(first.offers.map((o) => o.id))
  expect(second.offers.filter((o) => o.inView).length).toBeLessThan(first.offers.length)
})

// RFC 0002 §6.6, in the inspector (M7a): every choice set's comparison, under every policy, as the agent's view has it
test('under every built-in policy, every choice set comes with its comparison, one row per member', async () => {
  for (const policy of POLICIES) {
    const i = await inspect(principalFor(sid), { policy })
    for (const set of i.choiceSets) {
      expect(set.comparison, `${set.id} under ${policy}`).toBeDefined()
      expect(set.comparison!.rows).toHaveLength(set.members.length)
    }
  }
})

test("the audit's case: under advocated, the plans' comparison states Pro's bandwidth", async () => {
  const i = await inspect(principalFor(sid), { policy: 'advocated' })
  const set = i.choiceSets.find((c) => c.capability === 'hosting.plan.subscribe')!
  const pro = set.members.findIndex((m) => m.includes('hosting.plan:p2'))
  expect(set.comparison!.differ).toContain('bandwidthGb')
  expect(set.comparison!.rows[pro]!.bandwidthGb).toBe(100)
})

test('a facts limit cuts columns by name, never the ones the capability reads, and the inspector says which are read', async () => {
  const i = await inspect(principalFor(sid), { facts: 3 })
  const set = i.choiceSets.find((c) => c.capability === 'hosting.plan.subscribe')!
  // subscribe's charge reads the plan's price, and its summary the plan's name, which the person approves (§6.6)
  expect(set.marks.read).toEqual(expect.arrayContaining(['priceUsd', 'name']))
  for (const read of set.marks.read) expect(set.comparison!.omitted.attributes).not.toContain(read)
  expect(set.comparison!.omitted.attributes.length).toBeGreaterThan(0)
  for (const cut of set.comparison!.omitted.attributes)
    expect(set.comparison!.differ).not.toContain(cut)
})

// #9 (code review): the inspector marks exactly the columns the runtime keeps. Under a facts limit of 0 a view shows
// only those, so for every set a view shows, under every policy, the marks equal the columns its comparison still
// shows. A set the view leaves out is expanded whole, with no facts limit (RFC 0002 §6.6), so it isn't compared here
test("the inspector's marks are the runtime's kept columns, on every set a view shows, under every policy", async () => {
  store.account('inspect-kept')
  let compared = 0
  const principal = principalFor('inspect-kept')
  // the base manifest, and T6's claim edit, whose recommendation cites two attributes
  for (const [name, m] of [
    ['base', manifest],
    ['T6', TASK_EDITS.T6!.apply(manifest)],
  ] as const)
    for (const policy of POLICIES) {
      const inspection = await inspect(principal, { policy, facts: 0, m })
      for (const set of inspection.choiceSets.filter((s) => s.inView)) {
        compared++
        const c = set.comparison!
        const shown = [
          ...c.differ,
          ...Object.keys(c.shared),
          ...c.unsupplied.flatMap((u) => u.attributes),
        ]
        expect({
          name,
          policy,
          set: set.id,
          marks: [...new Set([...set.marks.cited, ...set.marks.read])].toSorted(),
        }).toEqual({
          name,
          policy,
          set: set.id,
          marks: [...new Set(shown)].toSorted(),
        })
      }
    }
  // the inspector projects with no start, so the plan set is in view under exhaustive, for both manifests
  expect(compared).toBe(2)
  // and a policy that omits claims cites none, whatever claims the capability has
  for (const policy of POLICIES.filter((p) => p === 'progressive'))
    for (const set of (await inspect(principal, { policy, m: TASK_EDITS.T6!.apply(manifest) }))
      .choiceSets)
      expect(set.marks.cited).toEqual([])
})
