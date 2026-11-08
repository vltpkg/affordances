// the docs' and README's examples for md()'s server side, type-checked by tsc (this package's tsconfig includes
// test/), so an example that stops compiling fails `vlt run typecheck`. each is written as its page shows it
import { NextResponse, type NextRequest } from 'next/server'
import { withMd } from '../src/next/index.ts'
import { mdProxy } from '../src/next/proxy.ts'

const nextConfig = {}

// setup.mdx, "Public URLs your proxy maps onto routes"
export const aliased = withMd(nextConfig, {
  aliases: {
    '/package/@:scope/:name/:rest*': '/package/@:scope%2F:name/:rest*',
  },
})

// setup.mdx, "With a proxy.ts": the gate-first recipe
export const gated = (request: NextRequest) => {
  const md = mdProxy(request)
  // your gates, first, on md.page: /dashboard.md and /dashboard with Accept are both /dashboard
  if (md.page.pathname.startsWith('/dashboard') && !request.cookies.has('session'))
    return md.redirect(new URL('/sign-in', request.url))
  return md.next()
}

// the app's own helpers the next two examples import from './site'
declare const collapse: (url: URL) => URL | undefined
declare const flagOn: (request: NextRequest) => boolean
declare const isFlagged: (pathname: string) => boolean

// setup.mdx, "With a proxy.ts": a proxy that also rewrites
export const rewriting = (request: NextRequest) => {
  const md = mdProxy(request)
  if (isFlagged(md.page.pathname) && !flagOn(request)) return md.redirect(new URL('/', request.url))
  if (md.markdown) return md.next()
  const url = collapse(request.nextUrl)
  return url ? NextResponse.rewrite(url) : NextResponse.next()
}

// setup.mdx, "Link from the proxy"
export const linked = (request: NextRequest) => {
  const md = mdProxy(request)
  if (md.markdown) return md.next()

  const url = collapse(request.nextUrl)
  if (!url) return NextResponse.next()
  const response = NextResponse.rewrite(url)
  if (md.link) response.headers.set('Link', md.link)
  return response
}
