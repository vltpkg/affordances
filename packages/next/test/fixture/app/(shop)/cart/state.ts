import { cart, defineState } from '../../../lib'

export default defineState(() => ({ cart: { items: [...cart] } }))
