'use server'

import { z } from 'zod'
import { defineAction } from '@/lib/afford'
import { searchProducts } from '@/lib/store'
import { listing } from './state'

export const search = defineAction({
  name: 'search',
  description:
    'Search the catalog by name, category, or description. Every word must match. Returns the matching products, with links to their pages.',
  input: z.object({ query: z.string().trim().min(1).max(100) }),
  expose: 'public',
  readOnly: true,
  effects: [],
  run: ({ query }) => ({ results: searchProducts(query).map(listing) }),
  message: ({ input, output }) =>
    `${output.results.length} ${output.results.length === 1 ? 'result' : 'results'} for “${input.query}”`,
})
