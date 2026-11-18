import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from '@affordances/mcp'
import { generate } from '@affordances/next/codegen'
import { createRouteHandler } from '@affordances/next/route'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, expect, test, vi } from 'vitest'
import * as store from '../src/lib/store.ts'

// M7b (4), M7f's v0 surface end to end: an agent's v0 MCP tools, affordances_open and affordances_call
// (packages/mcp), over the app's real v0 wire, where every action is bound to a capability and checked by the app's
// runtime (RFC 0001 §12.1). Over MCP, a subscribe asks for confirmation with the runtime's summary, then runs with
// confirm: true

// the actions' own revalidatePath needs Next's request store, which a handler outside Next doesn't have
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const root = path.join(import.meta.dirname, '..')
const site = 'https://hosting.test'
const API = '/api/affordances/graph'
let mcp: Client

beforeAll(async () => {
  generate(root)
  const { manifest } = (await import(
    pathToFileURL(path.join(root, '.affordances', 'manifest.ts')).href
  )) as { manifest: never }
  const handler = createRouteHandler({ manifest })
  // what withAffordances' rewrite does in Next: a page asked for in v0's media type goes to the graph route
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!url.pathname.startsWith(API) && !url.pathname.startsWith('/.well-known/'))
      url.pathname = `${API}${url.pathname === '/' ? '' : url.pathname}`
    return handler(new Request(url, init))
  }
  const sid = 's_m7b_mcp'
  store.account(sid)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer(site, { fetch: fetcher, token: sid }).connect(a)
  mcp = new Client({ name: 'm7b', version: '0' })
  await mcp.connect(b)
})

const read = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((result.content as { text: string }[])[0]!.text) as Record<string, any>

test('affordances_open shows the plans page’s bound actions, by v0 name', async () => {
  const graph = read(
    await mcp.callTool({ name: 'affordances_open', arguments: { path: '/plans' } }),
  )
  expect([graph.v, graph.route]).toEqual(['0', '/plans'])
  expect(graph.actions.map((a: { name: string }) => a.name).toSorted()).toEqual([
    'listPlans',
    'subscribe',
    'subscribeBundle',
  ])
})

test('affordances_call: a subscribe asks for confirmation with the runtime’s summary, then runs with confirm', async () => {
  const { id } = store.account('s_m7b_mcp').project
  const call = (confirm?: boolean) =>
    mcp.callTool({
      name: 'affordances_call',
      arguments: {
        path: '/plans',
        action: 'subscribe',
        input: { plan: 'p2', projectId: id },
        ...(confirm && { confirm }),
      },
    })
  expect(read(await call())).toMatchObject({
    ok: false,
    error: { code: 'confirm_required', message: expect.stringMatching(/Pro, for \d+ USD a month/) },
  })
  expect(store.account('s_m7b_mcp').project.plan).toBe('hobby')
  expect(read(await call(true))).toMatchObject({ ok: true })
  expect(store.account('s_m7b_mcp').project.plan).toBe('pro')
})
