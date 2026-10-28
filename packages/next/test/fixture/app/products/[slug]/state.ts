import { cart, defineState, stock } from '../../../lib'

export default defineState(({ params }) => ({
  product: { slug: params.slug as string, stock: stock[params.slug as string] ?? 0 },
  cart: { count: cart.length },
}))
