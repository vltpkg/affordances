import { defineState } from '@/lib/afford'
import { formatPrice, getOrders } from '@/lib/store'

export const loadOrders = (sid: string | null) => ({
  orders: getOrders(sid).map((order) => ({
    id: order.id,
    placedAt: order.placedAt,
    items: order.items.map(({ name, variant, quantity }) => ({ name, variant, quantity })),
    total: formatPrice(order.total),
  })),
})

export default defineState(({ ctx }) => loadOrders(ctx.session?.id ?? null))
