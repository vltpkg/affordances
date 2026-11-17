import type { Principal } from '@affordances/runtime'
import { principalFor } from './resolvers.ts'

// the caller's session from a request, as the app's v0 auth reads it: an agent sends `Authorization: Bearer <sid>`,
// a browser sends the sid cookie
// the bearer token, when the request carries one: `Bearer ` and nothing else isn't one
export const bearerOf = (request: Request): string | undefined =>
  request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]

export const sessionOf = (request: Request): string | null => {
  const bearer = bearerOf(request)
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1]
  return bearer ?? cookie ?? null
}

export const principalOf = (request: Request): Principal => principalFor(sessionOf(request))
