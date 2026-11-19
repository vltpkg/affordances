import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, sessionCookieOptions } from './lib/cookie.ts'
import { inspectorEnabled } from './lib/gate.ts'

// every page visitor gets a session before the page renders, so the project a page shows is the one its forms act
// on. The cookie goes on the request too, so the first render already reads it. An agent-facing request (/api/*)
// never gets one: a caller with no credential is anonymous there
export const proxy = (request: NextRequest) => {
  // the inspector exists only where it's turned on (src/lib/gate.ts)
  if (request.nextUrl.pathname.startsWith('/inspect') && !inspectorEnabled())
    return new NextResponse('Not found', { status: 404 })
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()
  if (request.cookies.has(SESSION_COOKIE) || request.headers.has('authorization'))
    return NextResponse.next()
  const sid = crypto.randomUUID()
  request.cookies.set(SESSION_COOKIE, sid)
  const response = NextResponse.next({ request: { headers: request.headers } })
  response.cookies.set(SESSION_COOKIE, sid, sessionCookieOptions)
  return response
}

export const config = { matcher: ['/((?!_next/|favicon).*)'] }
