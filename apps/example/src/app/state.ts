import { defineState } from '@/lib/afford'
import { formatPrice, listProducts, type Product } from '@/lib/store'

// one row of the index, also used by search
export const listing = (product: Product) => {
  const prices = product.variants.map((v) => v.price)
  const low = Math.min(...prices)
  const count = product.variants.length
  return {
    name: product.name,
    href: `/products/${product.slug}`,
    category: product.category,
    options: product.option ? `${count} ${product.option.toLowerCase()}s` : 'One size',
    price: low === Math.max(...prices) ? formatPrice(low) : `From ${formatPrice(low)}`,
    ...(product.variants.every((v) => v.stock === 0) && { soldOut: true }),
  }
}

export const loadIndex = () => ({ products: listProducts().map(listing) })

export default defineState(loadIndex, {
  description:
    'Every product with its price, options and stock; search finds products by name or category',
})
