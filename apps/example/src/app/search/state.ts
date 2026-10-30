import { defineState } from '@/lib/affordances'
import { searchProducts } from '@/lib/store'
import { listing } from '../state'

export const loadSearch = (query: string) => ({
  search: { query, results: searchProducts(query).map(listing) },
})

export default defineState(({ searchParams }) => loadSearch(searchParams.get('q')?.trim() ?? ''), {
  description: 'Products matching ?q=',
})
