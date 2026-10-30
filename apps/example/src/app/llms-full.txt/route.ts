import { createLlmsFullHandler } from '@affordances/md/next'
import { listProducts } from '@/lib/store'

export const GET = createLlmsFullHandler({
  pages: (_, routes) => [
    ...routes,
    ...listProducts().map((product) => `/products/${product.slug}`),
  ],
})
