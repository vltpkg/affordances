import { AffordError } from '@afford/core'
import { defineState } from '@/lib/afford'
import { cartCount, formatPrice, getProduct, quantityInCart } from '@/lib/store'

export const loadProduct = (slug: string, sid: string | null) => {
  const product = getProduct(slug)
  if (!product) return null
  return {
    product: {
      name: product.name,
      category: product.category,
      description: product.description,
      option: product.option,
      details: product.details,
      variants: product.variants.map((v) => {
        const inCart = quantityInCart(sid, v.sku)
        return {
          sku: v.sku,
          label: v.label,
          price: formatPrice(v.price),
          stock: v.stock,
          ...(inCart && { inCart }),
        }
      }),
    },
    cart: { count: cartCount(sid) },
  }
}

export type ProductState = NonNullable<ReturnType<typeof loadProduct>>
export type ProductVariant = ProductState['product']['variants'][number]

// what's left to add once the cart is counted
export const remaining = (variant: ProductVariant) => variant.stock - (variant.inCart ?? 0)

export default defineState(
  ({ params, ctx }) => {
    const state = loadProduct(String(params.slug), ctx.session?.id ?? null)
    if (!state) throw new AffordError('not_found', `No product at ${params.slug}`)
    return state
  },
  {
    description: 'One product: its variants (SKUs), prices and stock, and the cart count',
    nav: ({ cart }) => (cart.count ? [{ to: '/cart', label: 'Cart' }] : []),
  },
)
