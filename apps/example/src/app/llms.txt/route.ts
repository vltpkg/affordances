import { createLlmsTxtHandler } from '@affordances/md/next'
import { listProducts } from '@/lib/store'

// the site index names every route; the product pages behind /products/[slug] come from the catalog
export const GET = createLlmsTxtHandler({
  summary: 'Studio goods in small runs. A demo store that agents can operate: nothing ships.',
  sections: (_, routes) => [
    { title: 'Pages', pages: routes },
    { title: 'Products', pages: listProducts().map((product) => `/products/${product.slug}`) },
  ],
})
