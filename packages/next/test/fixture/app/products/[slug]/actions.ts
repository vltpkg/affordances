'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { cart, defineAction } from '../../../lib'

export const addToCart = defineAction({
  name: 'addToCart',
  description: 'Add the product to the cart',
  input: z.object({ slug: z.string() }),
  expose: 'public',
  effects: ['cart'],
  run: ({ slug }) => {
    cart.push(slug)
  },
})

export const buyNow = defineAction({
  name: 'buyNow',
  description: 'Skip the cart',
  input: z.object({}),
  expose: 'session',
  run: () => redirect('/checkout'),
})
