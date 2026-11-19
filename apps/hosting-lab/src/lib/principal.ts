import { credentialOf } from '@affordances/next/projection'
import type { Principal } from '@affordances/runtime'
import { SESSION_COOKIE } from './cookie.ts'
import { principalFor } from './resolvers.ts'

// which credential authenticates a request, read once for every route by next's one parser: an agent sends
// `Authorization: Bearer <sid>`, a browser sends the sid cookie, and the cookie's Origin rule is next's projection route's
export const sessionOf = (request: Request): string | null =>
  credentialOf(request, SESSION_COOKIE).token

export const principalOf = (request: Request): Principal => principalFor(sessionOf(request))
