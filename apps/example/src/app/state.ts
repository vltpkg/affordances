import { defineState } from '@/lib/afford'
import { formatPrice, listProducts, type Product } from '@/lib/store'

// one row of the index, also used by search
// the price shown is what you can buy now: the in-stock variants' prices, or all of them when it's sold out
export const listing = (product: Product) => {
  const available = product.variants.filter((v) => v.stock > 0)
  const prices = (available.length ? available : product.variants).map((v) => v.price)
  const low = Math.min(...prices)
  const count = product.variants.length
  return {
    name: product.name,
    href: `/products/${product.slug}`,
    category: product.category,
    options: product.option ? `${count} ${product.option.toLowerCase()}s` : 'One size',
    price: low === Math.max(...prices) ? formatPrice(low) : `From ${formatPrice(low)}`,
    inStock: available.length > 0,
  }
}

export const loadIndex = () => ({ products: listProducts().map(listing) })

export default defineState(loadIndex, {
  description:
    'Every product: its lowest in-stock price, options, and whether it is in stock. search finds products by name or category',
})
