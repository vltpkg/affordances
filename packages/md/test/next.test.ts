import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createMdHandler,
  md,
  mdAlternate,
  RENDER_HEADER,
  rewrites,
  withMd,
} from '../src/next/index.ts'

const site = 'https://shop.test'
const page = (body: string, head = '<title>Tee</title>') =>
  `<html><head>${head}</head><body><main>${body}</main></body></html>`

let upstream: (url: URL, init: RequestInit) => Response
let seen: { url: URL; headers: Headers }[]
beforeEach(() => {
  seen = []
  upstream = () =>
    new Response(page('<h1>Tee</h1><p>Boxy.</p>'), { headers: { 'content-type': 'text/html' } })
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    seen.push({ url, headers: new Headers(init.headers) })
    return upstream(url, init)
  })
})
afterEach(() => vi.unstubAllGlobals())

const handler = createMdHandler()
const get = (path: string, headers: Record<string, string> = {}) =>
  handler(new Request(`${site}/api/afford/md${path}`, { headers }))

test('renders the page as html from its own origin and converts it', async () => {
  const response = await get('/products/tee?color=black', {
    cookie: 'sid=1',
    'accept-language': 'en',
    'x-other': 'no',
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
  expect(response.headers.get('vary')).toBe('Accept')
  expect(await response.text()).toContain('# Tee\n\nBoxy.')
  const [call] = seen
  expect(call!.url.href).toBe(`${site}/products/tee?color=black`)
  expect(call!.headers.get(RENDER_HEADER)).toBe('1')
  expect(call!.headers.get('accept')).toBe('text/html')
  expect(call!.headers.get('cookie')).toBe('sid=1')
  expect(call!.headers.get('accept-language')).toBe('en')
  expect(call!.headers.get('x-other')).toBeNull()
  expect(Number(response.headers.get('x-afford-tokens'))).toBeGreaterThan(0)
})

test('next hands rewritten requests their original url: .md and index.md map back to the page', async () => {
  await handler(new Request(`${site}/products/tee.md?x=1`))
  await handler(new Request(`${site}/index.md`))
  await handler(new Request(`${site}/docs/index.md`))
  await handler(new Request(`${site}/products/tee`, { headers: { accept: 'text/markdown' } }))
  expect(seen.map((call) => call.url.pathname + call.url.search)).toEqual([
    '/products/tee?x=1',
    '/',
    '/docs/',
    '/products/tee',
  ])
})

test('the root path and the canonical link', async () => {
  upstream = () =>
    new Response(
      page('<h1>Home</h1>', '<title>Home</title><link rel="canonical" href="https://shop.test/">'),
      {
        headers: { 'content-type': 'text/html' },
      },
    )
  const response = await get('')
  expect(seen[0]!.url.pathname).toBe('/')
  expect(response.headers.get('link')).toBe('<https://shop.test/>; rel="canonical"')
})

test('credentials, private pages, and set-cookie make the markdown private; otherwise cache-control is mirrored', async () => {
  expect((await get('/a', { cookie: 'sid=1' })).headers.get('cache-control')).toBe(
    'private, no-store',
  )
  expect((await get('/a', { authorization: 'Bearer x' })).headers.get('cache-control')).toBe(
    'private, no-store',
  )
  upstream = () =>
    new Response(page('x'), {
      headers: { 'content-type': 'text/html', 'cache-control': 'private, max-age=0' },
    })
  expect((await get('/a')).headers.get('cache-control')).toBe('private, no-store')
  upstream = () =>
    new Response(page('x'), { headers: { 'content-type': 'text/html', 'set-cookie': 'a=1' } })
  expect((await get('/a')).headers.get('cache-control')).toBe('private, no-store')
  upstream = () =>
    new Response(page('x'), {
      headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' },
    })
  expect((await get('/a')).headers.get('cache-control')).toBe('public, max-age=60')
})

test('same-origin redirects stay in markdown; cross-origin ones are passed on, not followed', async () => {
  upstream = () => new Response(null, { status: 307, headers: { location: '/account/orders?x=1' } })
  expect((await get('/checkout')).headers.get('location')).toBe('/account/orders.md?x=1')
  upstream = () => new Response(null, { status: 308, headers: { location: '/' } })
  expect((await get('/old')).headers.get('location')).toBe('/index.md')
  upstream = () => new Response(null, { status: 302, headers: { location: 'https://evil.test/x' } })
  const cross = await get('/out')
  expect(cross.headers.get('location')).toBe('https://evil.test/x')
  expect(seen).toHaveLength(3)
})

test('errors keep their status; non-html passes through', async () => {
  upstream = () =>
    new Response(page('<h1>Not found</h1>'), {
      status: 404,
      headers: { 'content-type': 'text/html' },
    })
  const missing = await get('/nope')
  expect(missing.status).toBe(404)
  expect(await missing.text()).toContain('# Not found')
  upstream = () => Response.json({ a: 1 })
  const json = await get('/data')
  expect(json.headers.get('content-type')).toContain('application/json')
  expect(await json.json()).toEqual({ a: 1 })
})

test('loop guard, size limit, timeout', async () => {
  expect((await get('/a', { [RENDER_HEADER]: '1' })).status).toBe(508)
  expect(seen).toHaveLength(0)
  const small = createMdHandler({ maxBytes: 10 })
  expect((await small(new Request(`${site}/api/afford/md/a`))).status).toBe(413)
  vi.stubGlobal(
    'fetch',
    (_url: URL, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('abort'))),
      ),
  )
  expect(
    (await createMdHandler({ timeout: 5 })(new Request(`${site}/api/afford/md/slow`))).status,
  ).toBe(504)
})

test('origin override and append', async () => {
  const proxied = createMdHandler({
    origin: 'http://internal:3000',
    append: () => '## Actions\n\n- addToCart',
  })
  const response = await proxied(new Request(`${site}/api/afford/md/a`))
  expect(seen[0]!.url.href).toBe('http://internal:3000/a')
  expect(await response.text()).toMatch(/Boxy\.\n\n## Actions\n\n- addToCart\n$/)
})

test('rewrites send only markdown requests, never our own render, and skip api and files', () => {
  const [, pageRule] = rewrites.beforeFiles
  const re = new RegExp(`^/${pageRule!.source.slice('/:path'.length)}$`)
  expect(re.test('/blog/post')).toBe(true)
  expect(re.test('/api/afford/md/x')).toBe(false)
  expect(re.test('/_next/static/a.js')).toBe(false)
  expect(re.test('/sitemap.xml')).toBe(false)
  for (const rule of [...rewrites.beforeFiles, ...rewrites.afterFiles])
    expect(rule.missing).toEqual([{ type: 'header', key: RENDER_HEADER }])
})

test('md() composes with existing rewrites in either shape', async () => {
  const fromArray = (await md()({ rewrites: async () => [{ source: '/a', destination: '/b' }] })
    .rewrites!()) as unknown as {
    beforeFiles: unknown[]
    afterFiles: unknown[]
  }
  expect(fromArray.beforeFiles).toEqual(rewrites.beforeFiles)
  expect(fromArray.afterFiles).toEqual([
    ...rewrites.afterFiles,
    { source: '/a', destination: '/b' },
  ])
  const graph = { source: '/', destination: '/api/afford/graph' }
  const nested = (await withMd({ rewrites: async () => ({ beforeFiles: [graph] }) })
    .rewrites!()) as { beforeFiles: unknown[] }
  expect(nested.beforeFiles).toEqual([graph, ...rewrites.beforeFiles])
})

test('mdAlternate', () => {
  expect(mdAlternate('/')).toEqual({ types: { 'text/markdown': '/index.md' } })
  expect(mdAlternate('/blog/post/')).toEqual({ types: { 'text/markdown': '/blog/post.md' } })
})
