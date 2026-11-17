import { Delta, Graph, MEDIA_TYPE } from '@affordances/protocol'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
// the IR's authoring, as a dev dependency: core itself doesn't depend on the (private) IR package
import { defineCapability, defineResource, guard, when } from '@affordances/ir'
import {
  AFFORDANCES,
  createAffordances,
  createHandler,
  type AnyAction,
  type CheckRequest,
  type CheckRuntime,
} from '../src/index.ts'

type Session = { id: string }
let stock: Record<string, number>
let carts: Record<string, string[]>
beforeEach(() => {
  stock = { M: 3, L: 0 }
  carts = {}
})

const { defineAction, defineState } = createAffordances<Session>({
  auth: (request) => {
    const id = request.headers.get('authorization')?.replace('Bearer ', '')
    return id ? { id } : null
  },
})

const product = defineState(({ params, ctx }) => ({
  product: { slug: params.slug, stock: { ...stock } },
  cart: { items: ctx.session ? (carts[ctx.session.id] ?? []) : [] },
}))

const cartResource = defineResource({
  id: 'commerce.cart',
  description: "A shopper's cart",
  key: 'id',
  attributes: z.object({ id: z.string(), count: z.number().int() }),
})

const sizes = z.object({ size: z.enum(['M', 'L']) })
const inStock = ({
  input,
  state,
}: {
  input?: { size: 'M' | 'L' }
  state: { product: { stock: Record<string, number> } }
}) => !input || state.product.stock[input.size]! > 0 || `Size ${input.size} is out of stock`
const run = (i: { size: 'M' | 'L' }, ctx: { session: Session | null }) => {
  ;(carts[ctx.session!.id] ??= []).push(i.size)
  return { added: i.size }
}

// the same action twice: a plain v0 action, and one bound to a capability that declares only a guard
const plain = defineAction({
  name: 'addToCart',
  description: 'Add a size to the cart',
  input: sizes,
  state: product,
  expose: 'session',
  requires: 'The size is in stock',
  guard: inStock,
  effects: ['cart'],
  message: ({ input }) => `Added size ${input.size}`,
  run,
})

const addItem = defineCapability({
  id: 'commerce.cart.addItem',
  kind: 'action',
  description: 'Add a size to the cart',
  target: cartResource,
  input: sizes,
  authorization: { principal: 'authenticated' },
  preconditions: { inStock: guard('The size is in stock') },
})

const bound = defineAction({
  capability: addItem,
  name: 'addToCart',
  state: product,
  guards: { inStock },
  effects: ['cart'],
  message: ({ input }) => `Added size ${input.size}`,
  run,
})

const handlerFor = (actions: AnyAction[]) =>
  createHandler({
    manifest: { name: 'Test store', routes: { '/products/[slug]': { state: product, actions } } },
    basePath: '/api/affordances',
  })

const origin = 'https://store.test'
const graph = async (handler: ReturnType<typeof handlerFor>, session?: string) =>
  Graph.parse(
    await (
      await handler(
        new Request(`${origin}/api/affordances/products/tee`, {
          headers: { accept: MEDIA_TYPE, ...(session && { authorization: `Bearer ${session}` }) },
        }),
      )
    ).json(),
  )
const call = async (handler: ReturnType<typeof handlerFor>, body: unknown, session = 'a') =>
  Delta.parse(
    await (
      await handler(
        new Request(`${origin}/api/affordances/products/tee`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': MEDIA_TYPE, authorization: `Bearer ${session}` },
        }),
      )
    ).json(),
  )

describe('a capability with only guards', () => {
  test('describes itself to agents exactly as the plain v0 action does', async () => {
    expect(await graph(handlerFor([bound]), 'a')).toEqual(await graph(handlerFor([plain]), 'a'))
    expect(await graph(handlerFor([bound]))).toEqual(await graph(handlerFor([plain])))
  })

  test('answers calls exactly as the plain v0 action does', async () => {
    for (const body of [
      { action: 'addToCart', input: { size: 'M' } },
      { action: 'addToCart', input: { size: 'L' } },
      { action: 'addToCart', input: { size: 'XL' } },
    ]) {
      const expected = await call(handlerFor([plain]), body)
      carts = {}
      expect(await call(handlerFor([bound]), body)).toEqual(expected)
      carts = {}
    }
  })

  test('the UI path is unchanged: it validates input and runs, without guards', async () => {
    stock.M = 0
    // run needs a session on the UI path, for the bound action as for the plain one
    await expect(bound({ size: 'M' })).rejects.toThrow(/Cannot read/)
    await expect(plain({ size: 'M' })).rejects.toThrow(/Cannot read/)
    const ui = defineAction({
      capability: addItem,
      name: 'addToCart',
      guards: { inStock: () => 'never consulted on the UI path' },
      run: (i) => i.size,
    })
    expect(await ui({ size: 'M' })).toBe('M')
    await expect(ui({ size: 'S' } as never)).rejects.toThrow(/Input does not match/)
  })
})

describe('a capability with declarative preconditions, and no runtime', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  const declared = defineCapability({
    id: 'commerce.cart.checkout',
    kind: 'action',
    description: 'Place the order',
    target: cartResource,
    authorization: { principal: 'authenticated' },
    preconditions: {
      notEmpty: when.gt('target.count', 0).because('The cart has items'),
      inStock: guard('Every item is in stock'),
    },
  })
  const checkout = () => {
    const ran = vi.fn()
    const action = defineAction({
      capability: declared,
      name: 'checkout',
      state: product,
      guards: { inStock: () => true },
      run: () => {
        ran()
        return 'ordered'
      },
    })
    return { action, ran }
  }

  test('is refused on the agent path, naming each declarative condition', async () => {
    const { action, ran } = checkout()
    const delta = await call(handlerFor([action]), { action: 'checkout' })
    expect(delta).toMatchObject({
      ok: false,
      error: {
        code: 'unavailable',
        message:
          "The cart has items: can't be checked until the runtime serves commerce.cart.checkout",
      },
    })
    expect(ran).not.toHaveBeenCalled()
    const listed = (await graph(handlerFor([action]), 'a')).actions[0]
    expect(listed).toMatchObject({
      available: false,
      reason: expect.stringContaining('The cart has items'),
    })
  })

  test('warns when it is defined', () => {
    checkout()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('commerce.cart.checkout has declarative conditions (notEmpty)'),
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('until defineAction is given the runtime'),
    )
  })

  test('the UI path is unchanged', async () => {
    const { action, ran } = checkout()
    expect(await action({})).toBe('ordered')
    expect(ran).toHaveBeenCalledOnce()
  })
})

describe('what comes from the capability', () => {
  test("the action's metadata carries the capability's id", () => {
    expect(bound[AFFORDANCES].id).toBe('commerce.cart.addItem')
  })

  test('expose, readOnly, requires and the confirmation summary', async () => {
    const lookup = defineCapability({
      id: 'commerce.stock.read',
      kind: 'query',
      description: 'Read stock',
      authorization: { principal: 'any' },
    })
    const reserve = defineCapability({
      id: 'commerce.stock.reserve',
      kind: 'action',
      description: 'Reserve a size',
      input: sizes,
      authorization: { principal: 'authenticated' },
      confirmation: { summary: 'Reserve size {input.size} for {target.name} {{held}}' },
    })
    const handler = handlerFor([
      defineAction({ capability: lookup, name: 'lookup', run: () => ({ ...stock }) }),
      defineAction({ capability: reserve, name: 'reserve', run: () => 'held' }),
    ])
    const [read, hold] = (await graph(handler, 'a')).actions
    expect(read).toMatchObject({ expose: 'public', readOnly: true, input: { type: 'object' } })
    expect(hold).toMatchObject({ expose: 'confirm', description: 'Reserve a size' })
    expect(await call(handler, { action: 'reserve', input: { size: 'M' } })).toMatchObject({
      error: { code: 'confirm_required', message: 'Reserve size M for unknown {held}' },
    })
  })

  test('an event capability is refused', () => {
    const changed = defineCapability({
      id: 'commerce.stock.changed',
      kind: 'event',
      description: 'Stock changed',
    })
    expect(() => defineAction({ capability: changed, name: 'changed', run: () => {} })).toThrow(
      /is an event/,
    )
  })

  test('guards that a JSON-loaded or cast capability gets wrong are refused at definition', () => {
    expect(() =>
      defineAction({ capability: addItem, name: 'x', guards: {} as never, run: () => {} }),
    ).toThrow(/missing inStock/)
    expect(() =>
      defineAction({
        capability: addItem,
        name: 'x',
        guards: { inStock: () => true, extra: () => true } as never,
        run: () => {},
      }),
    ).toThrow(/not declared: extra/)
  })
})

describe('the types', () => {
  test('guards takes exactly one implementation per declared guard', () => {
    // type-checked, never run: the runtime refuses these too (above)
    const illTyped = () => {
      // @ts-expect-error inStock is missing
      defineAction({ capability: addItem, name: 'x', guards: {}, run: () => {} })
      defineAction({
        // @ts-expect-error extra isn't a guard addItem declares
        capability: addItem,
        name: 'x',
        guards: { inStock: () => true, extra: () => true },
        run: () => {},
      })
      // @ts-expect-error a capability with guards needs `guards`
      defineAction({ capability: addItem, name: 'x', run: () => {} })
    }
    expect(typeof illTyped).toBe('function')
    // the input is the capability's, and typed
    const typed = defineAction({
      capability: addItem,
      name: 'x',
      guards: { inStock: () => true },
      run: (i) => i.size,
    })
    expect(typeof typed).toBe('function')
  })
})

describe('the confirmation summary (RFC 0001 §3.2)', () => {
  test('a string as written, any other value as its canonical JSON text, and unknown for what v0 lacks', async () => {
    const ship = defineCapability({
      id: 'commerce.order.ship',
      kind: 'action',
      description: 'Ship an order',
      input: z.object({
        address: z.object({ street: z.string(), city: z.string() }),
        items: z.array(z.string()),
        note: z.string(),
        gift: z.boolean(),
        wrap: z.null(),
      }),
      authorization: { principal: 'authenticated' },
      confirmation: {
        summary:
          'Ship {input.items} to {input.address} ({input.note}, gift {input.gift}, wrap {input.wrap}) for {target.total} {{as is}}',
      },
    })
    const handler = handlerFor([
      defineAction({ capability: ship, name: 'ship', run: () => 'shipped' }),
    ])
    const delta = await call(handler, {
      action: 'ship',
      input: {
        address: { street: '1 Main', city: 'Springfield' },
        items: ['a', 'b'],
        note: 'leave at door',
        gift: true,
        wrap: null,
      },
    })
    expect(delta).toMatchObject({
      error: {
        code: 'confirm_required',
        // object members sorted, as RFC 8785: city before street
        message:
          'Ship ["a","b"] to {"city":"Springfield","street":"1 Main"} (leave at door, gift true, wrap null) for unknown {as is}',
      },
    })
  })
})

// the projection runtime's check, as RFC 0001 §12.1 and RFC 0002 §8.1 (steps 1-7) give it, standing in for the
// runtime: the cart's count is the declarative condition, and the summary is filled from the target

// v0's session as the runtime's principal
const principal = (ctx: { session: Session | null }) => ({
  authenticated: !!ctx.session,
  subject: ctx.session?.id,
  attributes: {},
})

describe('a capability checked by the runtime', () => {
  let count: number
  let requests: CheckRequest[]
  let projections: number
  // what the stand-in's projection lists for the capability, as RFC 0002 §4.2's availability
  let listed: { status: string; because?: readonly string[] }[]
  beforeEach(() => {
    count = 0
    requests = []
    projections = 0
    listed = [{ status: 'available' }]
  })
  const runtime: CheckRuntime = {
    check: async (request) => {
      requests.push(request)
      if (!request.principal.authenticated)
        return { status: 'refused', code: 'unauthorized', revision: 'sha256-r' }
      if (count === 0)
        return {
          status: 'refused',
          code: 'precondition',
          condition: { id: 'notEmpty', description: 'The cart has items' },
          detail: 'The cart is empty',
          revision: 'sha256-r',
        }
      if (request.offer === 'commerce.cart.checkout' && !request.confirmed)
        return {
          status: 'refused',
          code: 'confirmation_required',
          confirmation: { summary: `Place the order for ${count} items` },
          revision: 'sha256-r',
        }
      return {
        status: 'ok',
        revision: 'sha256-r',
        ...(request.confirmed && { confirmation: request.confirmed }),
      }
    },
    project: async () => {
      projections++
      return {
        offers: listed.map((availability) => ({
          capability: 'commerce.cart.checkout',
          availability,
        })),
      }
    },
  }
  const keyed = z.object({ cart: z.string() })
  const checkout = defineCapability({
    id: 'commerce.cart.checkout',
    kind: 'action',
    description: 'Place the order',
    target: cartResource,
    input: keyed,
    targetAt: 'cart',
    authorization: { principal: 'authenticated' },
    preconditions: { notEmpty: when.gt('target.count', 0).because('The cart has items') },
    confirmation: { summary: 'Place the order for {target.count} items' },
  })
  const action = () => {
    const ran = vi.fn()
    const checked = defineAction({
      capability: checkout,
      name: 'checkout',
      state: product,
      runtime,
      principal,
      run: () => {
        ran()
        return 'ordered'
      },
    })
    return { checked, ran }
  }

  test('refused while the condition is false, and available once it is true', async () => {
    const { checked, ran } = action()
    const refused = await call(handlerFor([checked]), {
      action: 'checkout',
      input: { cart: 'c1' },
      confirm: true,
    })
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'unavailable', message: 'The cart is empty' },
    })
    expect(ran).not.toHaveBeenCalled()
    // the capability's id, with the input that names the target at targetAt, for the principal from v0's session
    expect(requests.at(-1)).toMatchObject({
      offer: 'commerce.cart.checkout',
      input: { cart: 'c1' },
      principal: { authenticated: true, subject: 'a' },
    })
    count = 2
    expect(
      await call(handlerFor([checked]), {
        action: 'checkout',
        input: { cart: 'c1' },
        confirm: true,
      }),
    ).toMatchObject({ ok: true, output: 'ordered' })
    expect(ran).toHaveBeenCalledOnce()
  })

  test("without v0's confirm, it's v0's own confirm_required with the check's summary; with it, the basis is v0's flag", async () => {
    count = 2
    const { checked, ran } = action()
    const handler = handlerFor([checked])
    const response = await handler(
      new Request(`${origin}/api/affordances/products/tee`, {
        method: 'POST',
        body: JSON.stringify({ action: 'checkout', input: { cart: 'c1' } }),
        headers: { 'content-type': MEDIA_TYPE, authorization: 'Bearer a' },
      }),
    )
    expect(response.status).toBe(409)
    expect(Delta.parse(await response.json())).toMatchObject({
      ok: false,
      error: { code: 'confirm_required', message: 'Place the order for 2 items' },
    })
    expect(ran).not.toHaveBeenCalled()
    expect(requests.at(-1)!.confirmed).toBeUndefined()
    expect(
      await call(handler, { action: 'checkout', input: { cart: 'c1' }, confirm: true }),
    ).toMatchObject({ ok: true })
    // v0's confirmation, never an RFC 0002 approval: the request carries no token
    expect(requests.at(-1)).toMatchObject({ confirmed: { basis: 'v0-client-flag' } })
    expect(requests.at(-1)).not.toHaveProperty('approval')
  })

  test("listing the graph reads the offers' availability from the projection", async () => {
    const { checked } = action()
    for (const [offers, expected] of [
      [[{ status: 'available' }], { available: true }],
      // what the call settles, the input, doesn't rule it out
      [[{ status: 'needs-input' }], { available: true }],
      // nor does a condition the projection can't settle without the call's input or references
      [[{ status: 'unknown', because: ['notEmpty'] }], { available: true }],
      // one open offer among closed ones is enough
      [
        [{ status: 'unavailable', because: ['notEmpty'] }, { status: 'available' }],
        { available: true },
      ],
      [
        [{ status: 'unavailable', because: ['notEmpty'] }],
        { available: false, reason: 'The cart has items' },
      ],
      [
        [{ status: 'needs-authorization' }],
        { available: false, reason: 'commerce.cart.checkout needs another principal' },
      ],
      // no offer for it: nothing to say, so v0's own guards answer, and the call is checked
      [[], { available: true }],
    ] as const) {
      listed = [...offers]
      expect((await graph(handlerFor([checked]), 'a')).actions[0]).toMatchObject(expected)
    }
    // listing never checks: the check is for the call
    expect(requests).toHaveLength(0)
  })

  test('one projection per graph load, whatever it lists; a call checks once, between its two loads', async () => {
    count = 2
    const { checked } = action()
    const again = defineAction({
      capability: checkout,
      name: 'checkoutAgain',
      state: product,
      runtime,
      principal,
      run: () => 'ordered',
    })
    await graph(handlerFor([checked, again]), 'a')
    expect(projections).toBe(1)
    projections = 0
    await call(handlerFor([checked, again]), {
      action: 'checkout',
      input: { cart: 'c1' },
      confirm: true,
    })
    // the graph before the call, and the graph after it, which projects afresh
    expect(projections).toBe(2)
    expect(requests).toHaveLength(1)
  })

  test('the offer is the capability id, and any key reaches the runtime as written, in the input', async () => {
    count = 2
    const { checked } = action()
    // generated keys, with the characters an offer id treats as structure among them
    const alphabet = 'ab?&@:%=/~ 1é'
    const keys = Array.from({ length: 50 }, (_, i) =>
      Array.from(
        { length: 1 + (i % 9) },
        (__, j) => alphabet[(i * 7 + j * 3) % alphabet.length],
      ).join(''),
    )
    for (const key of keys) {
      await call(handlerFor([checked]), { action: 'checkout', input: { cart: key }, confirm: true })
      expect(requests.at(-1)).toMatchObject({
        offer: 'commerce.cart.checkout',
        input: { cart: key },
      })
    }
  })

  test("a refusal reads the condition's description when the runtime gives no detail", async () => {
    const quiet: CheckRuntime = {
      ...runtime,
      check: async () => ({
        status: 'refused',
        code: 'precondition',
        condition: { id: 'notEmpty', description: 'The cart has items' },
        revision: 'sha256-r',
      }),
    }
    const described = defineAction({
      capability: checkout,
      name: 'checkout',
      runtime: quiet,
      principal,
      run: () => 'ordered',
    })
    expect(
      await call(handlerFor([described]), { action: 'checkout', input: { cart: 'c1' } }),
    ).toMatchObject({ error: { message: 'The cart has items' } })
  })

  test('with a runtime there is no fail-closed warning, and the UI path is unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { checked, ran } = action()
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('declarative conditions'))
    warn.mockRestore()
    expect(await checked({ cart: 'c1' })).toBe('ordered')
    expect(ran).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(0)
  })
})
