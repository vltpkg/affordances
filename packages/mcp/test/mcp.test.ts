import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { expect, test } from 'vitest'
import { z } from 'zod'
import { createAfford, createHandler } from '@afford/core'
import { createClient } from '../src/client.ts'
import { createServer } from '../src/server.ts'

// a one-page site: a cookie session is created by the first call, and orders need confirm
const carts = new Map<string, number>()
const { defineAction, defineState } = createAfford<{ id: string }>({
  auth: (request) => {
    const id = request.headers.get('cookie')?.match(/sid=(\w+)/)?.[1]
    return id ? { id } : null
  },
})
let sessionCookie = ''
const add = defineAction({
  name: 'add',
  description: 'Add one',
  input: z.object({}),
  expose: 'public',
  effects: ['cart'],
  run: (_, ctx) => {
    if (!ctx.session) {
      ctx.session = { id: crypto.randomUUID().replaceAll('-', '') }
      sessionCookie = `sid=${ctx.session.id}; Path=/; HttpOnly`
    }
    carts.set(ctx.session.id, (carts.get(ctx.session.id) ?? 0) + 1)
  },
})
const order = defineAction({
  name: 'order',
  description: 'Order',
  input: z.object({}),
  expose: 'confirm',
  summary: () => 'Order 2 items',
  run: () => 'ordered',
})
const handler = createHandler({
  manifest: {
    name: 'Shop',
    routes: {
      '/': {
        state: defineState(({ ctx }) => ({ cart: carts.get(ctx.session?.id ?? '') ?? 0 })),
        actions: [add, order],
      },
    },
  },
})
const site = 'https://shop.test'
const fetcher: typeof fetch = async (input, init) => {
  sessionCookie = ''
  const response = await handler(new Request(input, init))
  if (sessionCookie) response.headers.append('set-cookie', sessionCookie)
  return response
}

test('the client keeps the session cookie and sends a matching Origin', async () => {
  const client = createClient(site, { fetch: fetcher })
  expect((await client.index()).name).toBe('Shop')
  expect((await client.open('/')).entities).toEqual({ cart: 0 })
  // the session the call started makes `order` available
  expect(await client.call('/', 'add', {})).toMatchObject({
    ok: true,
    changed: { cart: 1 },
    actionsAdded: [{ name: 'order', available: true }],
  })
  // the second call is cookie-authenticated, which the handler only allows with Origin
  expect(await client.call('/', 'add', {})).toEqual({ ok: true, changed: { cart: 2 } })
  expect((await client.open('/')).entities).toEqual({ cart: 2 })
  await expect(client.open('https://evil.test/')).rejects.toThrow('not on https://shop.test')
})

test('over MCP: open, call, confirm', async () => {
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer(site, { fetch: fetcher }).connect(a)
  const mcp = new Client({ name: 'test', version: '0' })
  await mcp.connect(b)

  expect((await mcp.listTools()).tools.map((t) => t.name)).toEqual(['afford_open', 'afford_call'])
  const read = (result: Awaited<ReturnType<typeof mcp.callTool>>) =>
    JSON.parse((result.content as { text: string }[])[0]!.text)

  const graph = read(await mcp.callTool({ name: 'afford_open', arguments: { path: '/' } }))
  expect(graph.actions.map((action: { name: string }) => action.name)).toEqual(['add', 'order'])

  const first = read(
    await mcp.callTool({ name: 'afford_call', arguments: { path: '/', action: 'add' } }),
  )
  expect(first).toMatchObject({ ok: true, changed: { cart: 1 } })
  const asked = read(
    await mcp.callTool({
      name: 'afford_call',
      arguments: { path: '/', action: 'order', input: {} },
    }),
  )
  expect(asked.error).toMatchObject({
    code: 'confirm_required',
    message: expect.stringContaining('Order 2 items'),
  })
  const done = read(
    await mcp.callTool({
      name: 'afford_call',
      arguments: { path: '/', action: 'order', input: {}, confirm: true },
    }),
  )
  expect(done).toEqual({ ok: true, output: 'ordered' })

  const missing = await mcp.callTool({ name: 'afford_open', arguments: { path: '/nope' } })
  expect(missing.isError).toBe(true)
})
