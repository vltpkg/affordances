import { beforeEach, expect, test } from 'vitest'
import { serveExpand, serveInspect, serveView } from '../src/lib/serve.ts'
import * as store from '../src/lib/store.ts'

// the agent-facing projection route answers with a view, for the caller its credentials name, and nothing more

beforeEach(() => store.reset())

const get = (query = '', headers: Record<string, string> = {}) =>
  serveView(new Request(`https://hosting.test/api/projection${query}`, { headers }))

test('a caller with a bearer session gets a view of their own projection', async () => {
  const response = await get('?policy=exhaustive', { authorization: 'Bearer s_view' })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  const view = await response.json()
  expect(Object.keys(view).toSorted()).toEqual([
    'choiceSets',
    'offers',
    'omitted',
    'order',
    'policy',
    'revision',
  ])
  expect(view.offers.map((o: { id: string }) => o.id)).toContain(
    `hosting.project.read@hosting.project:${store.account('s_view').project.id}`,
  )
})

test("a caller never sees another session's project", async () => {
  const theirs = store.account('s_other').project.id
  const view = await (await get('?policy=exhaustive', { authorization: 'Bearer s_mine' })).json()
  expect(JSON.stringify(view)).not.toContain(theirs)
})

test('without credentials, nothing per-project is offered, and subscribing needs authorization', async () => {
  const view = await (await get('?policy=exhaustive')).json()
  expect(
    view.offers.some((o: { target?: { type: string } }) => o.target?.type === 'hosting.project'),
  ).toBe(false)
  const subscribe = view.offers.find(
    (o: { capability: string }) => o.capability === 'hosting.plan.subscribe',
  )
  expect(subscribe.availability.status).toBe('needs-authorization')
})

test('a stale `seen` revision is marked, and the current one is not', async () => {
  const first = await (await get('', { authorization: 'Bearer s_seen' })).json()
  expect(
    (await (await get(`?seen=${first.revision}`, { authorization: 'Bearer s_seen' })).json()).stale,
  ).toBeUndefined()
  store.addAddOn('s_seen', store.account('s_seen').project.id, 'daily-backups')
  expect(
    (await (await get(`?seen=${first.revision}`, { authorization: 'Bearer s_seen' })).json()).stale,
  ).toBe(true)
})

test("the default policy is the start resource's offers, as a v0 page graph shows them", async () => {
  const id = store.account('s_start').project.id
  const view = await (
    await get(`?start=hosting.project:${id}`, { authorization: 'Bearer s_start' })
  ).json()
  expect(view.policy).toBe('resource')
  expect(view.offers.length).toBeGreaterThan(0)
  // offers on the project, and offers that take it as a reference (subscribing on a plan, for this project)
  type Offer = { target?: { key: string }; with?: Record<string, string> }
  expect(view.offers.every((o: Offer) => o.target?.key === id || o.with?.project === id)).toBe(true)
  expect(view.offers.map((o: { capability: string }) => o.capability)).toContain(
    'hosting.plan.subscribe',
  )
  // what it leaves out is counted, never hidden
  expect(view.omitted.offers).toBeGreaterThan(0)
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  serveExpand(
    new Request('https://hosting.test/api/projection/expand', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    }),
  )
const inspectGet = (query: string, headers: Record<string, string> = {}) =>
  serveInspect(new Request(`https://hosting.test/api/projection/inspect${query}`, { headers }))

test('every expansion a view lists answers with a view, never a projection', async () => {
  const auth = { authorization: 'Bearer s_expand' }
  const id = store.account('s_expand').project.id
  const view = await (await get(`?start=hosting.project:${id}`, auth)).json()
  expect(view.omitted.expand.length).toBeGreaterThan(0)
  for (const e of view.omitted.expand) {
    const response = await post(
      { start: `hosting.project:${id}`, from: e.from, along: e.along },
      auth,
    )
    expect(response.status).toBe(200)
    const more = await response.json()
    expect(Object.keys(more).toSorted()).toEqual(Object.keys(view).toSorted())
  }
})

test('expansion refuses what it cannot do, with a reason', async () => {
  expect((await post({ from: 'x', along: 'sideways' })).status).toBe(400)
  expect((await post({ along: 'more' })).status).toBe(400)
  expect((await post({ from: 'x', along: 'more', policy: 'secret' })).status).toBe(400)
})

test("inspecting an offer gives its definition; another caller's offer is not found", async () => {
  const auth = { authorization: 'Bearer s_insp' }
  const id = store.account('s_insp').project.id
  const offer = `hosting.project.read@hosting.project:${id}`
  const response = await inspectGet(`?offer=${encodeURIComponent(offer)}&policy=exhaustive`, auth)
  expect(response.status).toBe(200)
  const details = await response.json()
  expect(details.offer.id).toBe(offer)
  expect(details.definition.id).toBe('hosting.project.read')
  expect(
    (await inspectGet(`?offer=${encodeURIComponent(offer)}`, { authorization: 'Bearer s_other' }))
      .status,
  ).toBe(404)
  expect((await inspectGet('')).status).toBe(400)
})

test('an unknown policy is refused, not defaulted', async () => {
  const response = await get('?policy=secret')
  expect(response.status).toBe(400)
  expect((await response.json()).error).toContain('No policy secret')
})
