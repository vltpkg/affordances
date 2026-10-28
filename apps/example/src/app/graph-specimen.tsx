'use client'

import { useState } from 'react'
import { Button } from '@afford/ui/components/button'
import { JsonView } from '@afford/ui/components/json-view'

const graph = {
  v: '0',
  page: '/products/tee',
  route: '/products/[slug]',
  entities: {
    product: { slug: 'tee', name: 'Heavyweight Tee', price: 48, sizes: [1, 2, 3] },
    cart: { count: 0, items: [] as { sku: string; size: number }[] },
  },
  actions: [
    {
      name: 'addToCart',
      description: 'Add a product variant to the cart',
      input: {
        type: 'object',
        properties: { sku: { type: 'string' }, size: { type: 'number' } },
        required: ['sku', 'size'],
      },
      expose: 'session',
      available: true,
      effects: ['cart'],
    },
  ],
}

export const GraphSpecimen = () => {
  const [cart, setCart] = useState(graph.entities.cart)
  const add = () =>
    setCart({ count: cart.count + 1, items: [...cart.items, { sku: 'tee', size: 2 }] })

  return (
    <section className="mt-16">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">GET /products/tee</h2>
        <Button variant="outline" onClick={add}>
          Run addToCart
        </Button>
      </div>
      <div className="mt-4 rounded-lg border bg-illustration p-4">
        <JsonView
          value={{ ...graph, entities: { ...graph.entities, cart } }}
          highlight={['entities.cart']}
        />
      </div>
    </section>
  )
}
