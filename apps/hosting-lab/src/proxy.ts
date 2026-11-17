import { NextResponse, type NextRequest } from 'next/server'
import { inspectorEnabled } from './lib/gate.ts'

// every page visitor gets a session before the page renders, so the project a page shows is the one its forms act
// on. The cookie goes on the request too, so the first render already reads it. An agent-facing request (/api/*)
// never gets one: a caller with no credential is anonymous there
export const proxy = (request: NextRequest) => {
  // the inspector exists only where it's turned on (src/lib/gate.ts)
  if (request.nextUrl.pathname.startsWith('/inspect') && !inspectorEnabled())
    return new NextResponse('Not found', { status: 404 })
  if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next()
  if (request.cookies.has('sid') || request.headers.has('authorization')) return NextResponse.next()
  const sid = crypto.randomUUID()
  request.cookies.set('sid', sid)
  const response = NextResponse.next({ request: { headers: request.headers } })
  response.cookies.set('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return response
}

export const config = { matcher: ['/((?!_next/|favicon).*)'] }
