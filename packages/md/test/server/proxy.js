import { NextResponse } from 'next/server'
import { mdProxy } from '@affordances/md/next/proxy'

// gates, as a proxy.ts writes them: a flag gate's rewrite to another page with a status, and a third-party
// middleware's redirect, both adopted for a markdown request
export function proxy(request) {
  const md = mdProxy(request)
  if (md.page.pathname === '/flagged')
    return md.rewrite(new URL('/ok', request.url), { status: 404 })
  if (md.page.pathname === '/old')
    return md.adopt(NextResponse.redirect(new URL('/ok', request.url)))
  // a gate that checks the session and says who the visitor is, over whatever the client sent
  if (md.page.pathname === '/whoami') {
    const headers = new Headers(request.headers)
    headers.set('x-user-id', 'alice')
    return md.adopt(NextResponse.next({ request: { headers } }))
  }
  // a gate's rewrite to the same page, with its own query: markdown.js sees the query, never the gate's token
  if (md.page.pathname === '/who-rw')
    return md.rewrite(new URL('/whoami?via=rewrite', request.url), { status: 200 })
  return md.next()
}
