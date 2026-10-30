'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { defineAction } from '@/lib/affordances'
import { ensureSession } from '@/lib/session'
import * as store from '@/lib/store'
import product, { remaining } from './state'

export const addToCart = defineAction({
  name: 'addToCart',
  description:
    'Add a variant of this product to the cart, by SKU. Starts a session if there is none, so anonymous callers get a cart.',
  input: z.object({
    sku: z.string(),
    quantity: z.coerce.number().int().min(1).max(10).default(1),
  }),
  state: product,
  expose: 'public',
  requires: 'The variant is in stock',
  guard: ({ input, state }) => {
    const { name, option, variants } = state.product
    if (!input) return variants.some((v) => remaining(v) > 0) || `${name} is sold out`
    const variant = variants.find((v) => v.sku === input.sku)
    if (!variant) return `${input.sku} is not a SKU of ${name}`
    const what = option ? `${option} ${variant.label}` : name
    const left = remaining(variant)
    if (left >= input.quantity) return true
    if (variant.stock === 0) return `${what} is out of stock`
    return left === 0
      ? `Every ${what} in stock is already in the cart`
      : `Only ${left} left of ${what}`
  },
  // the cart is what an add changes for the caller; the page's own render picks up the rest
  effects: ['cart'],
  run: async ({ sku, quantity }, ctx) => {
    // the handler reloads state with this ctx after run, so the new session shows up in the delta
    ctx.session ??= { id: await ensureSession() }
    store.addToCart(ctx.session.id, sku, quantity)
    // every page shows the cart count; refresh() leaves streamed holes stale in production builds
    revalidatePath('/', 'layout')
  },
  message: ({ input }) => `Added ${input.quantity} × ${store.skuName(input.sku)} to the cart`,
})
