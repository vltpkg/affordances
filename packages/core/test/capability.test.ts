import { Delta, Graph, MEDIA_TYPE } from '@affordances/protocol'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
// the IR's authoring, as a dev dependency: core itself doesn't depend on the (private) IR package
import { defineCapability, defineResource, guard, when } from '@affordances/ir'
import { createAffordances, createHandler, type AnyAction } from '../src/index.ts'

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

describe('a capability with declarative preconditions (interim, until M3d)', () => {
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
  })

  test('the UI path is unchanged', async () => {
    const { action, ran } = checkout()
    expect(await action({})).toBe('ordered')
    expect(ran).toHaveBeenCalledOnce()
  })
})

describe('what comes from the capability', () => {
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
