import { NextRequest, NextResponse } from 'next/server'
import { afterEach, expect, expectTypeOf, test, vi } from 'vitest'
import { mdProxy, type MdProxy } from '../src/next/proxy.ts'
import { LITERAL_ENV } from '../src/next/routes.ts'

const site = 'https://shop.test'
const markdown = { accept: 'text/markdown' }
const proxy = (path: string, headers: Record<string, string> = {}) =>
  mdProxy(new NextRequest(`${site}${path}`, { headers }))
afterEach(() => vi.unstubAllEnvs())

test('md.page is the page a request is for, html or markdown, so every gate runs on the same url', () => {
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/x/:pkg']))
  const cases: [string, Record<string, string>, string, boolean][] = [
    ['/compare', {}, '/compare', false],
    ['/compare', markdown, '/compare', true],
    ['/compare.md', {}, '/compare', true],
    ['/compare/x.md?tab=a', {}, '/compare/x?tab=a', true],
    ['/index.md', {}, '/', true],
    ['/', markdown, '/', true],
    // a literalMd route's .md url may be a page of its own: the handler tells which, so it's gated whole
    ['/x/readme.md', {}, '/x/readme.md', true],
    // next's own client navigation, and api routes, are never markdown
    ['/compare', { ...markdown, rsc: '1' }, '/compare', false],
    ['/api/cart.md', {}, '/api/cart.md', false],
  ]
  for (const [path, headers, page, isMarkdown] of cases) {
    const md = proxy(path, headers)
    expect({ path, page: md.page.pathname + md.page.search, markdown: md.markdown }).toEqual({
      path,
      page,
      markdown: isMarkdown,
    })
  }
})

test("md.redirect sends a markdown request to the target's .md on this site, and any other target as it is", () => {
  const signIn = `${site}/sign-in?redirect_url=%2Fdashboard`
  const md = proxy('/dashboard.md')
  const gate = md.redirect(new URL('/sign-in?redirect_url=%2Fdashboard', site))
  expect([gate.status, gate.headers.get('location')]).toEqual([
    307,
    `${site}/sign-in.md?redirect_url=%2Fdashboard`,
  ])
  // a gate's answer depends on who asked, and it answers a url that serves html too
  expect([gate.headers.get('vary'), gate.headers.get('cache-control')]).toEqual([
    'Accept',
    'private, no-store',
  ])
  expect(proxy('/dashboard', markdown).redirect('/', 308).headers.get('location')).toBe(
    `${site}/index.md`,
  )
  expect(proxy('/dashboard', markdown).redirect('/', 308).status).toBe(308)
  // a path that starts with //host stays on this site
  expect(new URL(md.redirect('/.//evil.test/x').headers.get('location')!).origin).toBe(site)
  // another origin, or an html request, is NextResponse.redirect as it is
  expect(md.redirect('https://idp.test/authorize').headers.get('location')).toBe(
    'https://idp.test/authorize',
  )
  const html = proxy('/dashboard').redirect(signIn)
  expect([html.headers.get('location'), html.headers.get('cache-control')]).toEqual([signIn, null])
})

test('md.next sends a markdown request to the handler, and lets any other through', () => {
  const rewritten = proxy('/package/express.md?tab=a').next()
  expect(rewritten.headers.get('x-middleware-rewrite')).toBe(
    `${site}/api/affordances/md/package/express?tab=a`,
  )
  const through = proxy('/package/express').next({ headers: { 'x-extra': '1' } })
  expect(through.headers.get('x-middleware-next')).toBe('1')
  expect(through.headers.get('x-middleware-rewrite')).toBeNull()
  expect(through.headers.get('x-extra')).toBe('1')
})

test("md.link is a page request's Link value, and nothing for a markdown one", () => {
  expect(proxy('/package/express').link).toBe(
    '</package/express.md>; rel="alternate"; type="text/markdown"',
  )
  expect(proxy('/package/express.md').link).toBeUndefined()
  expect(proxy('/package/express', markdown).link).toBeUndefined()
})

test('mdProxy reads like the docs: no casts, and NextResponses out', () => {
  const md = mdProxy(new NextRequest(`${site}/x`))
  expectTypeOf(md).toEqualTypeOf<MdProxy>()
  expectTypeOf(md.page).toEqualTypeOf<URL>()
  expectTypeOf(md.redirect('/sign-in')).toEqualTypeOf<NextResponse>()
  expectTypeOf(md.next()).toEqualTypeOf<NextResponse>()
  expectTypeOf(md.link).toEqualTypeOf<string | undefined>()
  // a plain Request works too, as in a test
  expectTypeOf(mdProxy).parameter(0).toEqualTypeOf<Request>()
})

// the request headers a rewrite gives the route it rewrites to (NextResponse.rewrite's request.headers)
const sent = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`)
const TOKEN = 'build-token'

test('md.request is the page as a NextRequest, with the request method, headers and cookies', () => {
  const md = proxy('/dashboard.md?tab=a', { cookie: 'sid=1', 'x-flag': 'beta' })
  expect(md.request).toBeInstanceOf(NextRequest)
  expect([
    md.request.nextUrl.pathname + md.request.nextUrl.search,
    md.request.method,
    md.request.headers.get('x-flag'),
    md.request.cookies.get('sid')?.value,
  ]).toEqual(['/dashboard?tab=a', 'GET', 'beta', '1'])
})

test("md.rewrite gives a markdown request the destination page's markdown, with its status, and is NextResponse.rewrite otherwise", () => {
  vi.stubEnv('AFFORDANCES_MD_ADOPT', TOKEN)
  const flagged = proxy('/new-dashboard.md', { cookie: 'sid=1' }).rewrite('/404', { status: 404 })
  expect([
    flagged.headers.get('x-middleware-rewrite'),
    sent(flagged, 'x-affordances-md-adopt'),
    sent(flagged, 'cookie'),
    flagged.headers.get('cache-control'),
    flagged.headers.get('vary'),
  ]).toEqual([
    `${site}/api/affordances/md/404`,
    `${TOKEN};404;/404`,
    'sid=1',
    'private, no-store',
    'Accept',
  ])
  // a page request, and another origin, get next's own rewrite
  const html = proxy('/new-dashboard').rewrite('/beta')
  expect([html.headers.get('x-middleware-rewrite'), sent(html, 'x-affordances-md-adopt')]).toEqual([
    `${site}/beta`,
    null,
  ])
  expect(proxy('/x.md').rewrite('https://other.test/x').headers.get('x-middleware-rewrite')).toBe(
    'https://other.test/x',
  )
  expectTypeOf(proxy('/x').rewrite).parameters.toEqualTypeOf<
    Parameters<typeof NextResponse.rewrite>
  >()
})

test("md.adopt makes a middleware's own redirect or rewrite right for a markdown request, and leaves any other as it is", () => {
  vi.stubEnv('AFFORDANCES_MD_ADOPT', TOKEN)
  const md = proxy('/dashboard.md')
  // a gate's redirect to sign in, with the cookie it set: to the sign-in page's .md
  const gate = NextResponse.redirect(new URL('/sign-in', site))
  gate.cookies.set('handshake', '1')
  const redirected = md.adopt(gate)
  expect([
    redirected.status,
    redirected.headers.get('location'),
    redirected.headers.get('set-cookie'),
    redirected.headers.get('cache-control'),
  ]).toEqual([307, `${site}/sign-in.md`, 'handshake=1; Path=/', 'private, no-store'])
  // a flag gate's rewrite to a beta page, or to its 404: that page's markdown, with the gate's status
  const beta = md.adopt(NextResponse.rewrite(new URL('/beta/dashboard', site)))
  expect([beta.headers.get('x-middleware-rewrite'), sent(beta, 'x-affordances-md-adopt')]).toEqual([
    `${site}/api/affordances/md/beta/dashboard`,
    `${TOKEN};200;/beta/dashboard`,
  ])
  const missing = md.adopt(NextResponse.rewrite(new URL('/404', site), { status: 404 }))
  expect(sent(missing, 'x-affordances-md-adopt')).toBe(`${TOKEN};404;/404`)
  // let through: on to this page's markdown
  expect(md.adopt(NextResponse.next()).headers.get('x-middleware-rewrite')).toBe(
    `${site}/api/affordances/md/dashboard`,
  )
  // the gate's own answer stays its own, made private
  const denied = md.adopt(new Response('no', { status: 401 }))
  expect([denied.status, denied.headers.get('cache-control')]).toEqual([401, 'private, no-store'])
  // another origin, and a request that isn't for markdown, as they are
  const away = NextResponse.redirect('https://idp.test/authorize')
  expect(md.adopt(away)).toBe(away)
  const html = NextResponse.rewrite(new URL('/beta', site))
  expect(proxy('/dashboard').adopt(html)).toBe(html)
})

test('a caller sending the adopt header gets nothing: md.next never carries it, and only the token counts', () => {
  vi.stubEnv('AFFORDANCES_MD_ADOPT', TOKEN)
  const forged = { 'x-affordances-md-adopt': `${TOKEN};404;/admin` }
  // md's own rewrite sets it afresh, never the caller's
  const rewritten = proxy('/dashboard.md', forged).rewrite('/beta')
  expect(sent(rewritten, 'x-affordances-md-adopt')).toBe(`${TOKEN};200;/beta`)
  // without md()'s token in the build, a gate's answer never goes out unverified: 500, nothing carried
  vi.stubEnv('AFFORDANCES_MD_ADOPT', '')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const unverified = proxy('/dashboard.md', forged).rewrite('/beta')
  expect([
    unverified.status,
    unverified.headers.get('x-middleware-rewrite'),
    unverified.headers.get('cache-control'),
  ]).toEqual([500, null, 'private, no-store'])
  error.mockRestore()
})

test("md.adopt and md.rewrite carry the gate's own request headers to the page, and the destination's query", () => {
  vi.stubEnv('AFFORDANCES_MD_ADOPT', TOKEN)
  // the client says it's victim; the gate, having checked the session, says alice
  const md = proxy('/dashboard.md', { 'x-user-id': 'victim', cookie: 'sid=1' })
  const gate = new Headers({ 'x-user-id': 'alice', cookie: 'sid=1' })
  const through = md.adopt(NextResponse.next({ request: { headers: gate } }))
  expect([through.headers.get('x-middleware-rewrite'), sent(through, 'x-user-id')]).toEqual([
    `${site}/api/affordances/md/dashboard`,
    'alice',
  ])
  const flagged = md.adopt(
    NextResponse.rewrite(new URL('/beta', site), { request: { headers: gate } }),
  )
  expect([sent(flagged, 'x-user-id'), sent(flagged, 'x-affordances-md-adopt')]).toEqual([
    'alice',
    `${TOKEN};200;/beta`,
  ])
  const own = md.rewrite('/beta', { request: { headers: gate } })
  expect(sent(own, 'x-user-id')).toBe('alice')
  // a gate that set none: the client's own, as before
  expect(sent(md.adopt(NextResponse.rewrite(new URL('/beta', site))), 'x-user-id')).toBe('victim')
  // the destination's query goes along
  expect(sent(md.rewrite('/login?next=%2Fdashboard'), 'x-affordances-md-adopt')).toBe(
    `${TOKEN};200;/login?next=%2Fdashboard`,
  )
})
