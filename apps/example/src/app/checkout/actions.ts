'use server'

import { redirect } from '@afford/core'
import { refresh } from 'next/cache'
import { z } from 'zod'
import { defineAction } from '@/lib/afford'
import * as store from '@/lib/store'
import checkout from './state'

export const placeOrder = defineAction({
  name: 'placeOrder',
  description:
    'Place an order for everything in the cart. Reserves the stock and empties the cart. Nothing ships: this is a demo store.',
  input: z.object({}),
  state: checkout,
  expose: 'confirm',
  requires: 'The cart has items, and all of them are in stock',
  guard: ({ state }) => {
    const { items, count } = state.cart
    if (!count) return 'Your cart is empty'
    const short = items.find((i) => i.quantity > i.stock)
    return !short || `Only ${short.stock} left of ${short.name}`
  },
  summary: ({ state }) =>
    `Place an order for ${state.cart.count} ${state.cart.count === 1 ? 'item' : 'items'} totalling ${state.cart.subtotal}`,
  effects: ['cart'],
  run: (_, ctx) => {
    if (!ctx.session) throw new Error('No session')
    store.placeOrder(ctx.session.id)
    if (ctx.via === 'ui') refresh()
    redirect('/account/orders')
  },
  message: () => 'Order placed. It is listed under your orders.',
})
