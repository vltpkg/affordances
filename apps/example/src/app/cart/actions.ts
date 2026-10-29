'use server'

import { refresh } from 'next/cache'
import { z } from 'zod'
import { defineAction } from '@/lib/afford'
import * as store from '@/lib/store'
import cart from './state'

export const updateQuantity = defineAction({
  name: 'updateQuantity',
  description: 'Set the quantity of an item already in the cart. A quantity of 0 removes it.',
  input: z.object({ sku: z.string(), quantity: z.coerce.number().int().min(0).max(10) }),
  state: cart,
  expose: 'session',
  requires: 'The item is in the cart, and the new quantity is in stock',
  guard: ({ input, state }) => {
    if (!input) return state.cart.count > 0 || 'Your cart is empty'
    const item = state.cart.items.find((line) => line.sku === input.sku)
    if (!item) return `${input.sku} is not in the cart`
    return input.quantity <= item.stock || `Only ${item.stock} left of ${store.skuName(item.sku)}`
  },
  effects: ['cart'],
  run: ({ sku, quantity }, ctx) => {
    if (!ctx.session) throw new Error('No session')
    store.setQuantity(ctx.session.id, sku, quantity)
    if (ctx.via === 'ui') refresh()
  },
  message: ({ input }) =>
    input.quantity
      ? `${store.skuName(input.sku)} is now ${input.quantity} in the cart`
      : `Removed ${store.skuName(input.sku)} from the cart`,
})

export const removeItem = defineAction({
  name: 'removeItem',
  description: 'Remove an item from the cart, whatever its quantity.',
  input: z.object({ sku: z.string() }),
  state: cart,
  expose: 'session',
  requires: 'The item is in the cart',
  guard: ({ input, state }) => {
    if (!input) return state.cart.count > 0 || 'Your cart is empty'
    return (
      state.cart.items.some((line) => line.sku === input.sku) || `${input.sku} is not in the cart`
    )
  },
  effects: ['cart'],
  run: ({ sku }, ctx) => {
    if (!ctx.session) throw new Error('No session')
    store.removeFromCart(ctx.session.id, sku)
    if (ctx.via === 'ui') refresh()
  },
  message: ({ input }) => `Removed ${store.skuName(input.sku)} from the cart`,
})
