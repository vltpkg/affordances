import { createAffordances } from '@affordances/next'

// an agent sends `Authorization: Bearer <sid>`; a browser sends the sid cookie
const auth = (request: Request) => {
  const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1]
  const id = bearer ?? cookie
  return id ? { id } : null
}

export const { defineAction, defineState } = createAffordances<{ id: string }>({ auth })
