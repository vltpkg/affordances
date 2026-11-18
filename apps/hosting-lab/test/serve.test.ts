import { httpAdapter } from '@affordances/runtime/agent'
import { beforeEach, expect, test } from 'vitest'
import { serveExecute, serveExpand, serveInspect, serveView } from '../src/lib/serve.ts'
import * as store from '../src/lib/store.ts'

// the agent-facing projection route answers with a view, for the caller its credentials name, and nothing more

beforeEach(() => store.reset())

const get = (query = '', headers: Record<string, string> = {}) =>
  serveView(new Request(`https://hosting.test/api/projection${query}`, { headers }))

test('a caller with a bearer session gets a view of their own projection', async () => {
  const id = store.account('s_view').project.id
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
    `hosting.project.read@hosting.project:${id}`,
  )
})

test('reading creates nothing: a projection for an unknown session makes no account', async () => {
  const auth = { authorization: 'Bearer s_never' }
  const view = await (await get('?policy=exhaustive', auth)).json()
  expect(
    view.offers.some((o: { target?: { type: string } }) => o.target?.type === 'hosting.project'),
  ).toBe(false)
  await post(
    {
      policy: 'exhaustive',
      from: { type: 'hosting.project', key: 'proj_s_never' },
      along: 'relations',
    },
    auth,
  )
  await inspectGet('?offer=hosting.plan.list', auth)
  expect(store.findAccount('s_never')).toBeUndefined()
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
  store.addAddOn(store.account('s_seen').id, store.account('s_seen').project.id, 'daily-backups')
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

// code review of M8 (#1): RFC 0002 §6.6's expand along 'comparison' returns a choice set whole, over HTTP as in process,
// so the shared tool core that MCP and WebMCP run over httpAdapter can fetch it
test("a choice set expands along 'comparison' over HTTP, through the route and through httpAdapter", async () => {
  const auth = { authorization: 'Bearer s_compare' }
  const id = store.account('s_compare').project.id
  const view = await (await get(`?start=hosting.project:${id}`, auth)).json()
  const set = view.choiceSets[0]
  expect(set).toBeDefined()
  const response = await post(
    { start: `hosting.project:${id}`, from: set.id, along: 'comparison' },
    auth,
  )
  expect(response.status).toBe(200)
  const whole = await response.json()
  const expanded = whole.choiceSets.find((c: { id: string }) => c.id === set.id)
  expect(expanded.members).toEqual(set.members)
  expect(expanded.comparison.omitted.attributes).toEqual([])

  const routes: Record<string, (r: Request) => Promise<Response>> = {
    view: serveView,
    inspect: serveInspect,
    expand: serveExpand,
    execute: serveExecute,
  }
  const fetcher = (async (url: string, init?: RequestInit) =>
    routes[new URL(url).pathname.split('/').at(-1)!]!(
      new Request(url, { ...init, headers: { ...init?.headers, ...auth } }),
    )) as typeof fetch
  const adapter = httpAdapter('https://hosting.test/api/projection', fetcher, {
    start: { type: 'hosting.project', key: id },
  })
  const over = (await adapter.expand({ from: set.id, along: 'comparison' })) as typeof whole
  expect(over).toEqual(whole)
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

test('a budget that is not a positive whole number is refused', async () => {
  for (const offers of ['0', '-1', '2.5', 'many'])
    expect((await get(`?offers=${offers}`)).status).toBe(400)
})

test('an unknown policy is refused, not defaulted', async () => {
  const response = await get('?policy=secret')
  expect(response.status).toBe(400)
  expect((await response.json()).error).toContain('No policy secret')
})

test("paging inside an expansion: each page's cursor resolves on a fresh projection, with nothing shown twice", async () => {
  const auth = { authorization: 'Bearer s_page' }
  store.account('s_page')
  const base = { policy: 'exhaustive', offers: 2 }
  const budget = { offers: 2 }
  type E = { from: unknown; along: string }
  const first = await (await get('?policy=exhaustive&offers=2', auth)).json()
  expect(first.offers).toHaveLength(2)
  const more = first.omitted.expand.find((e: E) => e.along === 'more')
  // the first view's cursor resolves on a fresh projection
  const page2 = await (await post({ ...base, from: more.from, along: 'more', budget }, auth)).json()
  const more2 = page2.omitted.expand.find((e: E) => e.along === 'more')
  expect(more2).toBeDefined()
  // and so does page 2's: a cursor says where it came from
  const response = await post({ ...base, from: more2.from, along: 'more', budget }, auth)
  expect(response.status).toBe(200)
  const page3 = await response.json()
  const shown = new Set([...first.offers, ...page2.offers].map((o: { id: string }) => o.id))
  expect(page3.offers.length).toBeGreaterThan(0)
  expect(page3.offers.some((o: { id: string }) => shown.has(o.id))).toBe(false)
  // a cursor that isn't one is refused, with the runtime's reason
  const forged = await post({ ...base, from: 'more:not-a-cursor', along: 'more', budget }, auth)
  expect(forged.status).toBe(400)
})
