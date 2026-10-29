import { defineState } from '@/lib/afford'
import { loadCart } from '../cart/state'

export const loadCheckout = loadCart

export default defineState(({ ctx }) => loadCheckout(ctx.session?.id ?? null))
