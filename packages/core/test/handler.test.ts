import { readFileSync } from 'node:fs'
import { Delta, Graph, MEDIA_TYPE, SiteIndex } from '@affordances/protocol'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import {
  AffordancesError,
  createAffordances,
  createHandler,
  defineAction,
  redirect,
} from '../src/index.ts'

// a tiny store: one product with two variants, and a cart per session
type Session = { id: string }
let stock: Record<string, number>
let carts: Record<string, string[]>
let orders: string[]
beforeEach(() => {
  stock = { M: 3, L: 0 }
  carts = {}
  orders = []
})

const { defineAction: action, defineState } = createAffordances<Session>({
  auth: (request) => {
    const id = request.headers.get('authorization')?.replace('Bearer ', '')
    return id ? { id } : null
  },
})

const product = defineState(
  ({ params, ctx }) => ({
    product: { slug: params.slug, stock: { ...stock } },
    cart: { items: ctx.session ? (carts[ctx.session.id] ?? []) : [] },
  }),
  {
    description: 'One product and the cart',
    nav: ({ cart }) => (cart.items.length ? [{ to: '/checkout', label: 'Checkout' }] : []),
  },
)

const order = vi.fn<(step: string) => void>()

const addToCart = action({
  name: 'addToCart',
  description: 'Add a size to the cart',
  input: z.object({ size: z.enum(['M', 'L']) }),
  state: product,
  expose: 'session',
  requires: 'The size is in stock',
  guard: ({ input, state }) => {
    order('guard')
    return !input || state.product.stock[input.size]! > 0 || `Size ${input.size} is out of stock`
  },
  effects: ['cart'],
  message: ({ input }) => `Added size ${input.size}`,
  run: (input, ctx) => {
    order('run')
    ;(carts[ctx.session!.id] ??= []).push(input.size)
    return { added: input.size }
  },
})

const lookup = action({
  name: 'lookup',
  description: 'Anyone can read stock',
  input: z.object({}),
  expose: 'public',
  readOnly: true,
  run: () => ({ ...stock }),
})

const placeOrder = action({
  name: 'placeOrder',
  description: 'Place the order',
  input: z.object({}),
  state: product,
  expose: 'confirm',
  guard: ({ state }) => state.cart.items.length > 0 || 'Your cart is empty',
  summary: ({ state }) => `Order ${state.cart.items.length} item(s)`,
  run: (_, ctx) => {
    orders.push(ctx.session!.id)
    carts[ctx.session!.id] = []
    redirect('/orders')
  },
})

const restock = action({
  name: 'restock',
  description: 'Changes stock without declaring effects',
  input: z.object({ size: z.enum(['M', 'L']) }),
  expose: 'session',
  run: ({ size }) => {
    stock[size]! += 1
  },
})

const crash = action({
  name: 'crash',
  description: 'Throws',
  input: z.object({}),
  expose: 'public',
  run: () => {
    throw new Error('database password is hunter2')
  },
})

const teapot = action({
  name: 'teapot',
  description: 'Throws a protocol error',
  input: z.object({}),
  expose: 'public',
  run: () => {
    throw new AffordancesError('unavailable', 'Out of tea')
  },
})

const hidden = action({
  name: 'hidden',
  description: 'No expose: never reachable',
  input: z.object({}),
  run: () => 'secret',
})

const handler = createHandler({
  manifest: {
    name: 'Test store',
    routes: {
      '/products/[slug]': {
        state: product,
        actions: [addToCart, lookup, placeOrder, restock, crash, teapot, hidden],
      },
      '/products/featured': { actions: [lookup] },
      '/docs/[...slug]': { actions: [] },
    },
  },
  basePath: '/api/affordances',
  rateLimit: (args) => (args.action === 'lookup' && stock.M === 99 ? 10 : true),
})

const origin = 'https://store.test'
const get = (path: string, init: RequestInit = {}) =>
  handler(
    new Request(`${origin}/api/affordances${path}`, { headers: { accept: MEDIA_TYPE }, ...init }),
  )
const post = (
  body: unknown,
  { session, headers }: { session?: string; headers?: Record<string, string> } = {},
) =>
  handler(
    new Request(`${origin}/api/affordances/products/tee`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': MEDIA_TYPE,
        ...(session && { authorization: `Bearer ${session}` }),
        ...headers,
      },
    }),
  )
const delta = async (response: Response) => Delta.parse(await response.json())

describe('graph', () => {
  test('builds a valid graph with entities, actions, and nav', async () => {
    const response = await get('/products/tee', { headers: { authorization: 'Bearer a' } })
    expect(response.headers.get('content-type')).toBe(MEDIA_TYPE)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Accept')
    const graph = Graph.parse(await response.json())
    expect(graph).toMatchObject({ v: '0', page: '/products/tee', route: '/products/[slug]' })
    expect(graph.entities.product).toEqual({ slug: 'tee', stock: { M: 3, L: 0 } })
    expect(graph.actions.map((a) => a.name)).toEqual([
      'addToCart',
      'lookup',
      'placeOrder',
      'restock',
      'crash',
      'teapot',
    ])
    expect(graph.actions[0]).toMatchObject({
      expose: 'session',
      guard: 'The size is in stock',
      available: true,
      effects: ['cart'],
      input: { type: 'object', properties: { size: { enum: ['M', 'L'] } } },
    })
    expect(graph.actions.find((a) => a.name === 'placeOrder')).toMatchObject({
      available: false,
      reason: 'Your cart is empty',
    })
    expect(graph.nav).toEqual([])
  })

  test('session actions are listed but unavailable without a session', async () => {
    const graph = Graph.parse(await (await get('/products/tee')).json())
    const byName = Object.fromEntries(graph.actions.map((a) => [a.name, a]))
    expect(byName.addToCart).toMatchObject({ available: false, reason: 'Requires a session' })
    expect(byName.lookup).toMatchObject({ available: true, readOnly: true })
  })

  test('static routes beat dynamic ones', async () => {
    const graph = Graph.parse(await (await get('/products/featured')).json())
    expect(graph.route).toBe('/products/featured')
  })

  test('catch-all routes match, and unknown paths are not_found', async () => {
    expect(Graph.parse(await (await get('/docs/a/b')).json()).route).toBe('/docs/[...slug]')
    const response = await get('/nope')
    expect(response.status).toBe(404)
    expect((await delta(response)).error?.code).toBe('not_found')
  })

  test('site index describes every route and its exposed actions, enough to call them unopened', async () => {
    const index = SiteIndex.parse(await (await get('/.well-known/affordances.json')).json())
    expect(index.name).toBe('Test store')
    const productRoute = index.routes.find((r) => r.route === '/products/[slug]')!
    expect(productRoute.description).toBe('One product and the cart')
    expect(productRoute.actions.map((a) => a.name)).toEqual([
      'addToCart',
      'lookup',
      'placeOrder',
      'restock',
      'crash',
      'teapot',
    ])
    // the static descriptor, without this request's availability, and without the noise of $schema
    expect(productRoute.actions[0]).toEqual({
      name: 'addToCart',
      description: 'Add a size to the cart',
      input: expect.objectContaining({
        type: 'object',
        properties: { size: { type: 'string', enum: ['M', 'L'] } },
      }),
      expose: 'session',
      guard: 'The size is in stock',
      effects: ['cart'],
    })
    expect(JSON.stringify(index)).not.toContain('$schema')

    // calling straight from the index works: no GET of the page first
    const direct = await post({ action: 'addToCart', input: { size: 'M' } }, { session: 'z' })
    expect((await direct.json()).ok).toBe(true)
  })
})

describe('expose × auth', () => {
  const cases = [
    { expose: 'public', name: 'lookup', session: undefined, code: undefined },
    { expose: 'public', name: 'lookup', session: 'a', code: undefined },
    { expose: 'session', name: 'addToCart', session: undefined, code: 'unauthorized' },
    { expose: 'session', name: 'addToCart', session: 'a', code: undefined },
    { expose: 'confirm', name: 'placeOrder', session: undefined, code: 'unauthorized' },
    { expose: 'none', name: 'hidden', session: 'a', code: 'not_found' },
  ] as const
  test.each(cases)('$expose with session=$session → $code', async ({ name, session, code }) => {
    const result = await delta(await post({ action: name, input: { size: 'M' } }, { session }))
    expect(result.ok).toBe(!code)
    expect(result.error?.code).toBe(code)
  })
})

describe('call', () => {
  test('returns only effects keys, plus output', async () => {
    const response = await post({ action: 'addToCart', input: { size: 'M' } }, { session: 'a' })
    expect(response.status).toBe(200)
    expect(await delta(response)).toEqual({
      ok: true,
      changed: { cart: { items: ['M'] } },
      output: { added: 'M' },
      message: 'Added size M',
      // placeOrder became available now that the cart has an item
      actionsAdded: [expect.objectContaining({ name: 'placeOrder', available: true })],
    })
  })

  test('without effects, changed is a shallow diff', async () => {
    const result = await delta(
      await post({ action: 'restock', input: { size: 'L' } }, { session: 'a' }),
    )
    expect(result.changed).toEqual({ product: { slug: 'tee', stock: { M: 3, L: 1 } } })
  })

  test('validates before the guard, and runs the guard before run', async () => {
    order.mockClear()
    const invalid = await post({ action: 'addToCart', input: { size: 'XL' } }, { session: 'a' })
    expect(invalid.status).toBe(422)
    const body = await delta(invalid)
    expect(body.error).toMatchObject({ code: 'invalid_input', issues: [{ path: ['size'] }] })
    expect(order).not.toHaveBeenCalled()

    const unavailable = await delta(
      await post({ action: 'addToCart', input: { size: 'L' } }, { session: 'a' }),
    )
    expect(unavailable.error).toEqual({ code: 'unavailable', message: 'Size L is out of stock' })
    // the graph build evaluates the guard too; run never happened
    expect(order.mock.calls.flat()).not.toContain('run')
  })

  test('confirm actions need confirm: true, then redirect', async () => {
    await post({ action: 'addToCart', input: { size: 'M' } }, { session: 'a' })
    const first = await post({ action: 'placeOrder', input: {} }, { session: 'a' })
    expect(first.status).toBe(409)
    expect((await delta(first)).error).toMatchObject({
      code: 'confirm_required',
      message: expect.stringContaining('Order 1 item(s)'),
    })
    expect(orders).toEqual([])

    const second = await delta(
      await post({ action: 'placeOrder', input: {}, confirm: true }, { session: 'a' }),
    )
    expect(second).toMatchObject({
      ok: true,
      redirect: '/orders',
      changed: { cart: { items: [] } },
    })
    expect(second.actionsAdded).toEqual([
      expect.objectContaining({
        name: 'placeOrder',
        available: false,
        reason: 'Your cart is empty',
      }),
    ])
    expect(orders).toEqual(['a'])
  })

  test('cookie-authenticated calls need a matching Origin; bearer calls do not', async () => {
    const call = { action: 'lookup', input: {} }
    expect((await delta(await post(call, { headers: { cookie: 'sid=a' } }))).error?.code).toBe(
      'unauthorized',
    )
    expect(
      (await delta(await post(call, { headers: { cookie: 'sid=a', origin: 'https://evil.test' } })))
        .error?.code,
    ).toBe('unauthorized')
    expect((await delta(await post(call, { headers: { cookie: 'sid=a', origin } }))).ok).toBe(true)
    expect((await delta(await post(call, { session: 'a', headers: { cookie: 'sid=a' } }))).ok).toBe(
      true,
    )
  })

  test('rate limits answer 429 with Retry-After', async () => {
    stock.M = 99
    const response = await post({ action: 'lookup', input: {} })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('10')
    expect((await delta(response)).error?.code).toBe('rate_limited')
  })

  test('thrown errors become internal without leaking; AffordancesError keeps its code', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const crashed = await post({ action: 'crash', input: {} })
    expect(crashed.status).toBe(500)
    expect(JSON.stringify(await delta(crashed))).not.toContain('hunter2')
    error.mockRestore()
    expect((await delta(await post({ action: 'teapot', input: {} }))).error).toEqual({
      code: 'unavailable',
      message: 'Out of tea',
    })
  })

  test('malformed bodies are invalid_input; unknown methods are 405', async () => {
    expect((await delta(await post('nope'))).error?.code).toBe('invalid_input')
    expect((await get('/products/tee', { method: 'PUT' })).status).toBe(405)
  })

  test('every error code the handler emits matches a protocol fixture shape', () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL('../../protocol/fixtures/valid/delta.errors.json', import.meta.url),
        'utf8',
      ),
    )
    for (const fixture of fixtures) expect(Delta.safeParse(fixture).success).toBe(true)
  })
})

describe('server action (UI path)', () => {
  test('validates, accepts FormData, and runs with via: ui', async () => {
    const run = vi.fn<(input: { qty: number }) => number>((input) => input.qty * 2)
    const double = defineAction({
      name: 'double',
      description: '',
      input: z.object({ qty: z.coerce.number() }),
      expose: 'public',
      run: (input, ctx) => {
        expect(ctx.via).toBe('ui')
        return run(input)
      },
    })
    expect(await double({ qty: 2 })).toBe(4)
    const form = new FormData()
    form.set('qty', '5')
    form.set('$ACTION_ID_x', '')
    expect(await double(form)).toBe(10)
    expect(await double(undefined, form)).toBe(10)
    await expect(double({ qty: 'x' } as never)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  test('warns when expose is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    defineAction({ name: 'quiet', description: '', input: z.object({}), run: () => {} })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quiet has no `expose`'))
    warn.mockRestore()
  })
})
