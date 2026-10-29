import { defineState } from '@/lib/afford'
import { findVariant, formatPrice, getCart } from '@/lib/store'

export const loadCart = (sid: string | null) => {
  const items = getCart(sid).map((item) => ({ item, ...findVariant(item.sku)! }))
  const subtotal = items.reduce((sum, { item, variant }) => sum + item.quantity * variant.price, 0)
  return {
    cart: {
      items: items.map(({ item, product, variant }) => ({
        sku: item.sku,
        name: product.name,
        href: `/products/${product.slug}`,
        variant: product.option && `${product.option} ${variant.label}`,
        quantity: item.quantity,
        stock: variant.stock,
        price: formatPrice(variant.price),
        total: formatPrice(item.quantity * variant.price),
      })),
      count: items.reduce((sum, { item }) => sum + item.quantity, 0),
      subtotal: formatPrice(subtotal),
    },
  }
}

export type CartState = ReturnType<typeof loadCart>

export default defineState(({ ctx }) => loadCart(ctx.session?.id ?? null), {
  description: 'The cart: items, quantities and subtotal',
  nav: ({ cart }) => (cart.count ? [{ to: '/checkout', label: 'Checkout' }] : []),
})
