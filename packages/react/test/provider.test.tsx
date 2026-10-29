// @vitest-environment happy-dom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MEDIA_TYPE, type Graph } from '@affordances/protocol'
import { AffordancesProvider, useAffordances, type ModelContextTool } from '../src/index.ts'

// lets react know act() is available outside a test renderer
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const action = (name: string, extra: Partial<Graph['actions'][number]> = {}) => ({
  name,
  description: `${name} it`,
  input: { type: 'object' },
  expose: 'session' as const,
  available: true,
  ...extra,
})

const graph: Graph = {
  v: '0',
  page: '/products/tee',
  route: '/products/[slug]',
  entities: { cart: { count: 0 } },
  actions: [
    action('addToCart'),
    action('lookup', { readOnly: true }),
    action('placeOrder', { expose: 'confirm' }),
    action('notify', { available: false, reason: 'Sign in' }),
  ],
}

// the registered tools, live: abort removes one, as the browser would
let tools: Map<string, ModelContextTool>
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  tools = new Map()
  ;(document as { modelContext?: unknown }).modelContext = {
    registerTool: (tool: ModelContextTool, { signal }: { signal: AbortSignal }) => {
      tools.set(tool.name, tool)
      signal.addEventListener(
        'abort',
        () => tools.get(tool.name) === tool && tools.delete(tool.name),
      )
    },
  }
  fetchMock = vi.fn(async (_: string, init: RequestInit = {}) => {
    if (init.method !== 'POST')
      return new Response(JSON.stringify(graph), { headers: { 'content-type': MEDIA_TYPE } })
    const body = JSON.parse(init.body as string)
    if (body.action === 'placeOrder' && !body.confirm)
      return Response.json({
        ok: false,
        error: { code: 'confirm_required', message: 'Order 1 item' },
      })
    return Response.json({ ok: true, changed: { cart: { count: 1 } } })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (document as { modelContext?: unknown }).modelContext
})

const mount = async (ui: React.ReactNode) => {
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(ui))
  // let the graph fetch settle
  await act(async () => {})
  return root
}

test('registers every available action as a tool, with hints', async () => {
  const root = await mount(<AffordancesProvider path="/products/tee">{null}</AffordancesProvider>)
  expect([...tools.keys()].toSorted()).toEqual(['addToCart', 'lookup', 'placeOrder'])
  expect(tools.get('lookup')!.annotations).toEqual({ readOnlyHint: true, consequentialHint: false })
  expect(tools.get('placeOrder')!.annotations).toEqual({
    readOnlyHint: false,
    consequentialHint: true,
  })
  expect(fetchMock).toHaveBeenCalledWith(
    '/products/tee',
    expect.objectContaining({ headers: { accept: MEDIA_TYPE } }),
  )
  await act(async () => root.unmount())
  expect(tools.size).toBe(0)
})

test('strict mode double mount leaves one live registration per tool', async () => {
  const root = await mount(
    <StrictMode>
      <AffordancesProvider path="/products/tee">{null}</AffordancesProvider>
    </StrictMode>,
  )
  expect([...tools.keys()].toSorted()).toEqual(['addToCart', 'lookup', 'placeOrder'])
  await act(async () => root.unmount())
  expect(tools.size).toBe(0)
})

test('tools call the page endpoint and report the delta', async () => {
  const onDelta = vi.fn()
  await mount(
    <AffordancesProvider path="/products/tee" onDelta={onDelta}>
      {null}
    </AffordancesProvider>,
  )
  const result = await act(() => tools.get('addToCart')!.execute({ sku: 'M' }, {}))
  expect(JSON.parse(result as string)).toEqual({ ok: true, changed: { cart: { count: 1 } } })
  expect(onDelta).toHaveBeenCalledWith({ ok: true, changed: { cart: { count: 1 } } })
  const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
  expect(init.headers['content-type']).toBe(MEDIA_TYPE)
  expect(JSON.parse(init.body)).toEqual({ action: 'addToCart', input: { sku: 'M' } })
})

test('confirm actions ask the person, then resend with confirm: true', async () => {
  const confirm = vi.fn(async () => true)
  await mount(
    <AffordancesProvider path="/checkout" confirm={confirm}>
      {null}
    </AffordancesProvider>,
  )
  const result = await act(() => tools.get('placeOrder')!.execute({}, {}))
  expect(confirm).toHaveBeenCalledWith('Order 1 item')
  expect(JSON.parse(result as string).ok).toBe(true)
  const posts = fetchMock.mock.calls
    .filter(([, i]) => i?.method === 'POST')
    .map(([, i]) => JSON.parse(i.body))
  expect(posts).toEqual([
    { action: 'placeOrder', input: {} },
    { action: 'placeOrder', input: {}, confirm: true },
  ])
})

test('a declined confirm sends nothing more', async () => {
  await mount(
    <AffordancesProvider path="/checkout" confirm={() => false}>
      {null}
    </AffordancesProvider>,
  )
  const result = await act(() => tools.get('placeOrder')!.execute({}, {}))
  expect(JSON.parse(result as string).error.code).toBe('confirm_required')
  expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
})

test('useAffordances exposes the graph', async () => {
  let seen: Graph | null = null
  const Probe = () => {
    seen = useAffordances().graph
    return null
  }
  await mount(
    <AffordancesProvider path="/products/tee">
      <Probe />
    </AffordancesProvider>,
  )
  expect(seen).toEqual(graph)
})

test('no modelContext: nothing registers, nothing throws', async () => {
  delete (document as { modelContext?: unknown }).modelContext
  await mount(<AffordancesProvider path="/products/tee">{null}</AffordancesProvider>)
  expect(tools.size).toBe(0)
})
