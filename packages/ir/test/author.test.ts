import { expect, expectTypeOf, test } from 'vitest'
import { z } from 'zod'
import {
  AUTHORING_SOURCE,
  defineCapability,
  defineClaims,
  defineManifest,
  definePrincipal,
  defineResource,
  guard,
  validate,
  when,
  type GuardsOf,
  type InputOf,
} from '../src/index.ts'

// RFC 0001 §12.1's authoring: a small store and a hosting provider, written the way an application would
const product = defineResource({
  id: 'commerce.product',
  description: 'A product with variants',
  key: 'slug',
  attributes: z.object({
    slug: z.string(),
    variants: z.array(z.object({ sku: z.string(), stock: z.number().int() })),
  }),
})

const cart = defineResource({
  id: 'commerce.cart',
  description: "A shopper's cart",
  key: 'id',
  attributes: z.object({ id: z.string(), count: z.number().int(), skus: z.array(z.string()) }),
  contains: [product],
})

const order = defineResource({ id: 'commerce.order', description: 'A placed order', key: 'id' })

const shopper = definePrincipal({ attributes: z.object({ verified: z.boolean() }) })

const addItem = defineCapability({
  id: 'commerce.cart.addItem',
  kind: 'action',
  description: 'Add a variant of a product to the cart, by SKU',
  target: cart,
  input: z.object({ productId: z.string(), sku: z.string(), quantity: z.number().int().min(1) }),
  references: { product: { resource: product, at: 'productId' } },
  authorization: { principal: 'any' },
  preconditions: {
    inStock: when
      .some(
        'product.variants',
        when.all(when.eq('item.sku', when.path('input.sku')), when.gt('item.stock', 0)),
      )
      .because('The variant is in stock'),
    underLimit: guard('The cart holds at most 50 items'),
  },
  effects: [
    {
      category: 'state',
      change: 'update',
      resource: cart,
      description: 'Adds the item to the cart',
      establishes: when.gt('target.count', 0),
      reversibility: 'reversible',
    },
  ],
})

const refund = defineCapability({
  id: 'commerce.order.refund',
  kind: 'action',
  description: 'Refund an order',
  target: order,
  authorization: { principal: 'authenticated' },
})

const checkout = defineCapability({
  id: 'commerce.cart.checkout',
  kind: 'action',
  description: 'Place an order for everything in the cart',
  target: cart,
  input: z.object({}),
  principal: shopper,
  authorization: {
    principal: 'authenticated',
    conditions: {
      verified: when.eq('principal.verified', true).because('The shopper is verified'),
    },
  },
  confirmation: { summary: 'Place an order for {target.count} items, and pay its total' },
  preconditions: {
    notEmpty: when.gt(when.count('target.skus'), 0).because('The cart has items'),
    inStock: guard('Every item is in stock'),
  },
  effects: [
    {
      category: 'financial',
      description: "Charges the cart's total",
      reversibility: 'compensable',
      compensatedBy: refund,
    },
    { category: 'state', change: 'create', resource: order, description: 'Creates an order' },
  ],
})

const store = defineManifest({
  namespace: 'https://store.example/capabilities',
  owner: { id: 'store', name: 'Example Store' },
  principal: shopper,
  resources: [product, cart, order],
  capabilities: [addItem, checkout, refund],
})

test('an authored manifest is valid IR', () => {
  const result = validate(store)
  expect(result.issues.filter((i) => i.code.startsWith('E_'))).toEqual([])
  expect(result.ok).toBe(true)
})

test('conditions become the IR array, with ids from the keys', () => {
  const def = store.capabilities.find((c) => c.id === 'commerce.cart.addItem')!
  expect(def.preconditions).toEqual([
    {
      id: 'inStock',
      description: 'The variant is in stock',
      expr: {
        some: {
          of: 'product.variants',
          where: {
            all: [
              { eq: [{ path: 'item.sku' }, { path: 'input.sku' }] },
              { gt: [{ path: 'item.stock' }, { value: 0 }] },
            ],
          },
        },
      },
    },
    { id: 'underLimit', description: 'The cart holds at most 50 items', guard: true },
  ])
  expect(def.references).toEqual([
    { name: 'product', resource: 'commerce.product', at: '/productId' },
  ])
  expect(def.effects?.[0]).toMatchObject({
    establishes: { gt: [{ path: 'target.count' }, { value: 0 }] },
  })
})

test('count, principal conditions and references to other definitions', () => {
  const def = store.capabilities.find((c) => c.id === 'commerce.cart.checkout')!
  expect(def.preconditions?.[0]).toEqual({
    id: 'notEmpty',
    description: 'The cart has items',
    expr: { gt: [{ count: 'target.skus' }, { value: 0 }] },
  })
  expect(def.authorization).toEqual({
    principal: 'authenticated',
    conditions: [
      {
        id: 'verified',
        description: 'The shopper is verified',
        expr: { eq: [{ path: 'principal.verified' }, { value: true }] },
      },
    ],
  })
  expect(def.effects?.[0]).toMatchObject({ compensatedBy: 'commerce.order.refund' })
})

test('Standard Schema is converted to JSON Schema, recorded as inferred by the authoring tool', () => {
  const def = store.capabilities.find((c) => c.id === 'commerce.cart.addItem')!
  expect(def.input).toMatchObject({ type: 'object', required: ['productId', 'sku', 'quantity'] })
  expect(def.input).not.toHaveProperty('$schema')
  expect(def.fieldProvenance).toEqual({ '/input': { source: AUTHORING_SOURCE, basis: 'inferred' } })
  expect(store.sources).toEqual([
    { id: 'store', role: 'owner', name: 'Example Store' },
    { id: AUTHORING_SOURCE, role: 'tool', name: '@affordances/ir authoring' },
  ])
  expect(store.provenance).toEqual({ source: 'store', basis: 'declared' })
  // a definition with nothing converted has no field provenance
  expect(store.resources.find((r) => r.id === 'commerce.order')).not.toHaveProperty(
    'fieldProvenance',
  )
})

test('a manifest authored without conversions declares no tool source', () => {
  const m = defineManifest({
    namespace: 'https://plain.example/capabilities',
    owner: { name: 'Plain' },
    resources: [order],
    capabilities: [refund],
  })
  expect(m.sources).toEqual([{ id: 'owner', role: 'owner', name: 'Plain' }])
})

test('claims take the owner as their source, and keep applies', () => {
  const plan = defineResource({
    id: 'hosting.plan',
    description: 'A hosting plan',
    key: 'slug',
    attributes: z.object({ slug: z.string(), priceUsd: z.number() }),
    alternatives: true,
  })
  const subscribe = defineCapability({
    id: 'hosting.plan.subscribe',
    kind: 'action',
    description: 'Subscribe the project to this plan',
    target: plan,
    authorization: { principal: 'authenticated' },
    confirmation: { summary: 'Subscribe to {target.slug} for {target.priceUsd} USD a month' },
    effects: [
      {
        category: 'financial',
        description: 'Starts a monthly charge',
        reversibility: 'irreversible',
      },
    ],
  })
  const m = defineManifest({
    namespace: 'https://host.example/capabilities',
    owner: { id: 'host', name: 'Example Host' },
    resources: [plan],
    capabilities: [subscribe],
    claims: [
      defineClaims({
        proRecommended: {
          subject: subscribe,
          kind: 'recommendation',
          statement: 'Recommended for production projects',
          applies: when.eq('target.slug', 'pro'),
        },
      }),
    ],
  })
  expect(m.claims).toEqual([
    {
      id: 'proRecommended',
      subject: 'hosting.plan.subscribe',
      kind: 'recommendation',
      statement: 'Recommended for production projects',
      applies: { eq: [{ path: 'target.slug' }, { value: 'pro' }] },
      provenance: { source: 'host', basis: 'declared' },
    },
  ])
  expect(validate(m).ok).toBe(true)
})

test("a schema that can't describe itself as JSON Schema is refused, with what it was for", () => {
  const opaque = {
    '~standard': { version: 1, vendor: 'other', validate: (v: unknown) => ({ value: v }) },
  } as const
  expect(() =>
    defineCapability({ id: 'x.y', kind: 'action', description: 'x', input: opaque }),
  ).toThrow(/x\.y's input: this schema \(other\) can't produce JSON Schema/)
})

// ---- what the types infer ----

test('guard ids and input are inferred from the capability', () => {
  expectTypeOf<GuardsOf<typeof addItem>>().toEqualTypeOf<'underLimit'>()
  expectTypeOf<GuardsOf<typeof checkout>>().toEqualTypeOf<'inStock'>()
  expectTypeOf<GuardsOf<typeof refund>>().toEqualTypeOf<never>()
  expectTypeOf<InputOf<typeof addItem>>().toEqualTypeOf<{
    productId: string
    sku: string
    quantity: number
  }>()
})

test('condition paths are checked against attributes, input, references and the principal', () => {
  const base = { id: 'commerce.cart.t', kind: 'action', description: 't', target: cart } as const
  defineCapability({
    ...base,
    // @ts-expect-error 'target.cout' isn't an attribute of the cart
    preconditions: { a: when.gt('target.cout', 0).because('typo') },
  })
  defineCapability({
    ...base,
    input: z.object({ sku: z.string() }),
    // @ts-expect-error 'input.skew' isn't in the input
    preconditions: { a: when.eq('input.skew', 'x').because('typo') },
  })
  defineCapability({
    ...base,
    input: z.object({ productId: z.string() }),
    references: { product: { resource: product, at: 'productId' } },
    // @ts-expect-error a quantifier's item is checked against the element type: variants have no 'size'
    preconditions: { a: when.some('product.variants', when.gt('item.size', 0)).because('typo') },
  })
  defineCapability({
    ...base,
    // @ts-expect-error no principal is declared, so principal paths have nothing to read
    preconditions: { a: when.eq('principal.verified', true).because('no principal') },
  })
  defineCapability({
    ...base,
    input: z.object({ sku: z.string() }),
    authorization: {
      principal: 'any',
      // @ts-expect-error authorization conditions read only principal and target (RFC 0001 §3.2)
      conditions: { a: when.eq('input.sku', 'x').because('input in authorization') },
    },
  })
  defineCapability({
    ...base,
    input: z.object({ sku: z.string() }),
    // @ts-expect-error a reference's `at` is an input property
    references: { product: { resource: product, at: 'productSlug' } },
  })
  defineResource({
    id: 'a.b',
    description: 'b',
    // @ts-expect-error the key is one of the attributes
    key: 'nope',
    attributes: z.object({ id: z.string() }),
  })
  defineCapability({
    ...base,
    input: z.object({ productId: z.string() }),
    references: { product: { resource: product, at: 'productId' } },
    effects: [
      {
        category: 'state',
        change: 'update',
        resource: cart,
        description: 'x',
        // @ts-expect-error what an effect establishes reads only the target (RFC 0001 §4)
        establishes: when.exists('product.slug'),
      },
    ],
  })
  defineCapability({
    ...base,
    input: z.object({ productId: z.string() }),
    references: { product: { resource: product, at: 'productId' } },
    // @ts-expect-error elements are reached through a quantifier's item, never a [] segment
    preconditions: { a: when.eq('product.variants.[].sku', 'x').because('no [] paths') },
  })
  // targetAt names an input property, and needs a target
  const located = defineCapability({
    ...base,
    input: z.object({ cart: z.string() }),
    targetAt: 'cart',
  })
  expect(located.definition.targetAt).toBe('/cart')
  defineCapability({
    ...base,
    input: z.object({ cart: z.string() }),
    // @ts-expect-error targetAt is an input property
    targetAt: 'basket',
  })
  defineCapability({
    id: 'x.y',
    kind: 'action',
    description: 'no target',
    input: z.object({ cart: z.string() }),
    // @ts-expect-error targetAt needs a target
    targetAt: 'cart',
  })
  // no input and no principal: the target's paths still type, and nothing else's
  const targetOnly = defineCapability({
    ...base,
    preconditions: { a: when.ne('target.count', 0).because('not empty') },
    effects: [
      {
        category: 'state',
        change: 'update',
        resource: cart,
        description: 'x',
        establishes: when.eq('target.count', 0),
      },
    ],
  })
  expect(targetOnly.definition.preconditions).toHaveLength(1)
  defineCapability({
    ...base,
    // @ts-expect-error there's no input to read
    preconditions: { a: when.eq('input.sku', 'x').because('no input') },
  })
  // and the valid forms compile: nested quantifiers, bare item over scalars, counts, paths on both sides
  const valid = defineCapability({
    ...base,
    input: z.object({ productId: z.string(), quantities: z.array(z.number()) }),
    references: { product: { resource: product, at: 'productId' } },
    preconditions: {
      a: when.every('input.quantities', when.le('item', 10)).because('each at most 10'),
      b: when.in('input.productId', when.path('target.skus')).because('in the cart'),
      c: when.not(when.exists('product.slug')).because('no slug'),
      d: when
        .any(when.ge(when.count('product.variants'), 1), when.eq('target.count', 0))
        .because('either'),
    },
  })
  expect(valid.definition.preconditions?.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
})

test('defineManifest refuses a manifest validate rejects, saying where', () => {
  expect(() =>
    defineManifest({
      namespace: 'https://broken.example/capabilities',
      owner: { name: 'Broken' },
      // the cart contains products, which this manifest doesn't declare
      resources: [cart],
      capabilities: [],
    }),
  ).toThrow(/E_UNRESOLVED at \/resources\/0\/contains\/0/)
})
