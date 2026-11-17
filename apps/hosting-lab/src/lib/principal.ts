import type { Principal } from '@affordances/runtime'
import { SESSION_COOKIE } from './cookie.ts'
import { principalFor } from './resolvers.ts'

// which credential authenticates a request, read once for every route: an agent sends `Authorization: Bearer
// <sid>`, a browser sends the sid cookie. A bearer header that names no single token (`Bearer `, `Bearer a b`)
// authenticates nothing, so the cookie does, and the cookie's rules apply (src/lib/serve.ts, crossSite)
export type Credential =
  | { session: string; via: 'bearer' | 'cookie' }
  | { session: null; via: null }

export const credentialOf = (request: Request): Credential => {
  const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
  if (bearer) return { session: bearer, via: 'bearer' }
  const cookie = request.headers
    .get('cookie')
    ?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1]
  if (cookie) return { session: cookie, via: 'cookie' }
  return { session: null, via: null }
}

export const sessionOf = (request: Request): string | null => credentialOf(request).session

export const principalOf = (request: Request): Principal => principalFor(sessionOf(request))
