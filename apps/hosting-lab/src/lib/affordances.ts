import { createAffordances } from '@affordances/next'

import { sessionOf } from './principal.ts'

// an agent sends `Authorization: Bearer <sid>`; a browser sends the sid cookie (src/lib/principal.ts)
const auth = (request: Request) => {
  const id = sessionOf(request)
  return id ? { id } : null
}

export const { defineAction, defineState } = createAffordances<{ id: string }>({ auth })
