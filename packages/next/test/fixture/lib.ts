import { createAfford } from '@afford/core'

export const stock: Record<string, number> = { tee: 2 }
export const cart: string[] = []
export const { defineAction, defineState } = createAfford<{ id: string }>({
  auth: (request) => (request.headers.has('authorization') ? { id: 'a' } : null),
})
