import type { Principal } from '@affordances/runtime'
import { principalFor } from './resolvers.ts'

// the caller's session from a request, as the app's v0 auth reads it: an agent sends `Authorization: Bearer <sid>`,
// a browser sends the sid cookie
export const sessionOf = (request: Request): string | null => {
  const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1]
  return bearer ?? cookie ?? null
}

export const principalOf = (request: Request): Principal => principalFor(sessionOf(request))
