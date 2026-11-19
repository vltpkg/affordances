import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Call, Delta, Graph, MEDIA_TYPE, SiteIndex } from '@affordances/protocol'
import { generate } from '@affordances/next/codegen'
import { createRouteHandler } from '@affordances/next/route'
import { beforeAll, expect, test, vi } from 'vitest'
import * as store from '../src/lib/store.ts'

// M7b, the v0 adapter, IR to v0 (RFC 0001 §12.1; repo audit §6): the app's real actions, every one bound to a capability
// module, served on v0's wire by v0's own handler, from the manifest v0's codegen generates. Every document validates
// against the protocol's schemas (the zod source that schemas/*.json are generated from) at v: '0', and the agent
// path's runtime check answers in v0's own codes

// the actions' own revalidatePath needs Next's request store, which a handler outside Next doesn't have: it's what a
// run does after the state changes, not part of v0's wire
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const root = path.join(import.meta.dirname, '..')
let handler: (request: Request) => Promise<Response>
let routes: string[]
let declared: Record<string, { actions: unknown[] }>

beforeAll(async () => {
  generate(root)
  const { manifest } = (await import(
    pathToFileURL(path.join(root, '.affordances', 'manifest.ts')).href
  )) as { manifest: { routes: Record<string, { actions: unknown[] }> } }
  routes = Object.keys(manifest.routes)
  declared = manifest.routes
  handler = createRouteHandler({ manifest: manifest as never })
})

const origin = 'https://hosting.test'
const get = (url: string, sid?: string) =>
  handler(
    new Request(`${origin}${url}`, {
      headers: { accept: MEDIA_TYPE, ...(sid && { authorization: `Bearer ${sid}` }) },
    }),
  )
const post = async (route: string, body: unknown, sid: string) => {
  Call.parse(body)
  const response = await handler(
    new Request(`${origin}/api/affordances/graph${route === '/' ? '' : route}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': MEDIA_TYPE, authorization: `Bearer ${sid}` },
    }),
  )
  return { status: response.status, delta: Delta.parse(await response.json()) }
}

test('every route’s Graph validates as v0, names its bound actions, and the site index lists every route', async () => {
  const sid = 's_m7b_graph'
  store.account(sid)
  // a dynamic route is opened at one of its real keys: a plan's page at Pro's slug
  const examples: Record<string, string> = { '/plans/[slug]': '/plans/pro' }
  for (const route of routes) {
    const opened = examples[route] ?? route
    const response = await get(`/api/affordances/graph${opened === '/' ? '' : opened}`, sid)
    expect({ route, status: response.status }).toEqual({ route, status: 200 })
    const graph = Graph.parse(await response.json())
    expect([graph.v, graph.route]).toEqual(['0', route])
    // every action the route binds, and none more: a plan's own page binds none, since it only reads
    expect(graph.actions.length).toBe(declared[route]!.actions.length)
  }
  expect(Object.keys(examples).every((r) => routes.includes(r))).toBe(true)
  const index = SiteIndex.parse(await (await get('/.well-known/affordances.json')).json())
  expect(index.v).toBe('0')
  expect(index.routes.map((r) => r.route).toSorted()).toEqual(routes.toSorted())
})

test('a bound action through v0’s Call: the runtime’s summary as v0’s confirm_required, then it runs with confirm', async () => {
  const sid = 's_m7b_call'
  const { id } = store.account(sid).project
  const input = { plan: 'p2', projectId: id }
  const refused = await post('/plans', { action: 'subscribe', input }, sid)
  expect(refused.status).toBe(409)
  expect(refused.delta).toMatchObject({
    ok: false,
    error: { code: 'confirm_required', message: expect.stringMatching(/Pro, for \d+ USD a month/) },
  })
  expect(store.account(sid).project.plan).toBe('hobby')
  const ran = await post('/plans', { action: 'subscribe', input, confirm: true }, sid)
  expect(ran.delta).toMatchObject({ ok: true })
  expect(store.account(sid).project.plan).toBe('pro')
})

test('a condition the runtime finds false answers as v0’s unavailable, with its detail', async () => {
  const sid = 's_m7b_unavailable'
  const { id } = store.account(sid).project
  // cancel needs a paid plan to renew from; a new account renews as Hobby
  const refused = await post('/', { action: 'cancel', input: { projectId: id } }, sid)
  expect(refused.delta).toMatchObject({
    ok: false,
    error: { code: 'unavailable', message: expect.stringContaining('paid plan') },
  })
})
