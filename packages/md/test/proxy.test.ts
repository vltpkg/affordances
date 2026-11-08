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
