'use server'

import { z } from 'zod'
import { defineAction } from '@/lib/affordances'
import { formatPrice, searchProducts } from '@/lib/store'
import { listing } from './state'

export const search = defineAction({
  name: 'search',
  description:
    "Search the catalog by name, category, or description. Every word must match. Returns the matching products with each variant's SKU and stock, so addToCart on the product's page can follow without opening it.",
  input: z.object({ query: z.string().trim().min(1).max(100) }),
  expose: 'public',
  readOnly: true,
  effects: [],
  // each result carries its variants: the next step is usually adding one, and that needs a SKU
  run: ({ query }) => ({
    results: searchProducts(query).map((product) => ({
      ...listing(product),
      variants: product.variants.map((v) => ({
        sku: v.sku,
        label: v.label,
        price: formatPrice(v.price),
        inStock: v.stock > 0,
      })),
    })),
  }),
  message: ({ input, output }) =>
    `${output.results.length} ${output.results.length === 1 ? 'result' : 'results'} for “${input.query}”`,
})
