import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { NextConfig } from 'next'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createLlmsFullHandler,
  createLlmsTxtHandler,
  createMdHandler,
  type Config,
  type Has,
  type Header,
  isMdRequest,
  md,
  mdAlternate,
  mdLink,
  mdPagePath,
  mdProxy,
  PARTIAL_HEADER,
  mdRewrite,
  RENDER_HEADER,
  type Rewrite,
  type Rewrites,
  rewrites,
  withMd,
  type LlmsSection,
} from '../src/next/index.ts'
import { aliasPath, hasTwin } from '../src/next/rules.ts'
import {
  ALIASES_ENV,
  LITERAL_ENV,
  HANDLERS_ENV,
  PUBLIC_ENV,
  ROUTES_ENV,
  scanApp,
  unfitExports,
  sourceParams,
  sourceRegex,
  writeMarkdownRoutes,
} from '../src/next/routes.ts'
import { routes as authored } from './markdown-routes.ts'

const site = 'https://shop.test'
const page = (body: string, head = '<title>Tee</title>') =>
  `<html><head>${head}</head><body><main>${body}</main></body></html>`

let upstream: (url: URL, init: RequestInit) => Response
let seen: { url: URL; headers: Headers }[]
// the app's markdown route, as a request of its own: next/headers reads each request's own headers, which this
// stands in for
let routed: { url: URL; headers: Headers }[]
const requestContext = new AsyncLocalStorage<Headers>()
beforeEach(() => {
  seen = []
  routed = []
  upstream = () =>
    new Response(page('<h1>Tee</h1><p>Boxy.</p>'), { headers: { 'content-type': 'text/html' } })
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    const headers = new Headers(init.headers)
    // what the app's rewrites send to the markdown route, which next hands the url as requested; or the route's own url
    const asked = new Request(url, { headers })
    if (mdRewrite(asked) || new URL(url).pathname.startsWith('/api/affordances/md')) {
      routed.push({ url: new URL(url), headers })
      return requestContext.run(headers, () => createMdHandler()(asked))
    }
    seen.push({ url, headers })
    return upstream(url, init)
  })
})
afterEach(() => vi.unstubAllGlobals())

const handler = createMdHandler()
const get = (path: string, headers: Record<string, string> = {}) =>
  handler(new Request(`${site}/api/affordances/md${path}`, { headers }))

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
  expect(Number(response.headers.get('x-affordances-tokens'))).toBeGreaterThan(0)
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
  // fetch hands back the body decoded, so the encoding it came in no longer applies
  upstream = () =>
    new Response('body', {
      headers: { 'content-type': 'image/png', 'content-encoding': 'gzip', 'content-length': '99' },
    })
  const file = await get('/logo.png')
  expect(file.headers.get('content-type')).toBe('image/png')
  expect(file.headers.get('content-encoding')).toBeNull()
  expect(file.headers.get('content-length')).toBeNull()
  expect(await file.text()).toBe('body')
})

test('loop guard, size limit, timeout', async () => {
  expect((await get('/a', { [RENDER_HEADER]: '1' })).status).toBe(508)
  expect(seen).toHaveLength(0)
  const small = createMdHandler({ maxBytes: 10 })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const tooLarge = await small(new Request(`${site}/api/affordances/md/a`))
  // what to change, in the answer and the server's log: a page that grows past it is the site's to fix
  const fix =
    'To convert it, raise maxBytes in the md route (app/api/affordances/md/[[...path]]/route.ts): `export const GET = createMdHandler({ maxBytes: 1 * 1024 * 1024 })`.'
  expect([tooLarge.status, await tooLarge.text()]).toEqual([
    413,
    `# The page is too large to convert\n\nIts HTML is larger than 10 bytes (maxBytes). ${fix}\n`,
  ])
  expect(warn).toHaveBeenCalledWith(
    `[affordances-md] /a is larger than maxBytes (10 bytes), so it answers 413. ${fix}`,
  )
  // the default, 6 MiB, suggests twice it
  upstream = () =>
    new Response(page('<h1>Big</h1>'), {
      headers: { 'content-type': 'text/html', 'content-length': String(7 * 1024 * 1024) },
    })
  expect(await (await get('/big')).text()).toContain(
    'larger than 6 MiB (maxBytes). To convert it, raise maxBytes in the md route (app/api/affordances/md/[[...path]]/route.ts): `export const GET = createMdHandler({ maxBytes: 12 * 1024 * 1024 })`.',
  )
  warn.mockRestore()
  vi.stubGlobal(
    'fetch',
    (_url: URL, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('abort'))),
      ),
  )
  expect(
    (await createMdHandler({ timeout: 5 })(new Request(`${site}/api/affordances/md/slow`))).status,
  ).toBe(504)
})

test("a page the handler can't reach answers 502, naming no origin in production; one that's slow is still 504", async () => {
  // a real fetch, to a port nothing listens on
  vi.unstubAllGlobals()
  const { createServer } = await import('node:net')
  const port = await new Promise<number>((resolve) => {
    const server = createServer().listen(0, () => {
      const { port: free } = server.address() as { port: number }
      server.close(() => resolve(free))
    })
  })
  vi.stubEnv('AFFORDANCES_MD_ORIGIN', `http://127.0.0.1:${port}`)
  vi.stubEnv('NODE_ENV', 'production')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  for (const path of ['/a.md', '/a']) {
    const response = await createMdHandler()(
      new Request(
        `${site}${path}`,
        path === '/a' ? { headers: { accept: 'text/markdown', rsc: '1' } } : {},
      ),
    )
    const body = await response.text()
    expect([path, response.status, response.headers.get('cache-control')]).toEqual([
      path,
      502,
      'private, no-store',
    ])
    expect(body).toBe("# Couldn't reach the page to convert it\n\n/a\n")
  }
  expect(warn).not.toHaveBeenCalled()
  // in development, the cause and the origin, in the body and the server's log
  vi.stubEnv('NODE_ENV', 'development')
  const dev = await (await createMdHandler()(new Request(`${site}/a.md`))).text()
  expect(dev).toContain(`/a (http://127.0.0.1:${port}: TypeError: fetch failed)`)
  expect(String(warn.mock.calls[0]?.[0])).toContain(
    `couldn't reach http://127.0.0.1:${port}/a to convert it`,
  )
  warn.mockRestore()
  vi.unstubAllEnvs()
})

// a page that streams its shell, then never finishes: one boundary resolved, one still on its fallback
const stalls = (chunks: string[]) => () => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
    },
  })
  return new Response(body, {
    headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' },
  })
}

test('markdown served at a url that also serves html is never cached publicly, on every branch', async () => {
  const accept = { accept: 'text/markdown' }
  // a permanent redirect at the page url
  upstream = () =>
    new Response(null, {
      status: 308,
      headers: { location: '/login', 'cache-control': 's-maxage=31536000' },
    })
  expect(
    (await handler(new Request(`${site}/public/old`, { headers: accept }))).headers.get(
      'cache-control',
    ),
  ).toBe('private, no-store')
  // the twin url is its own, so it mirrors the page
  expect((await handler(new Request(`${site}/public/old.md`))).headers.get('cache-control')).toBe(
    's-maxage=31536000',
  )
  // a page with no cache-control of its own
  upstream = () =>
    new Response(page('<h1>Plain</h1>'), { headers: { 'content-type': 'text/html' } })
  expect(
    (await handler(new Request(`${site}/plain`, { headers: accept }))).headers.get('cache-control'),
  ).toBe('private, no-store')
  // a literalMd page whose own url ends in .md also serves html
  literally({ '/x/readme.md': 200 })
  upstream = () =>
    new Response(page('<h1>readme.md</h1>'), {
      headers: { 'content-type': 'text/html', 'cache-control': 's-maxage=31536000' },
    })
  expect(
    (await handler(new Request(`${site}/x/readme.md`, { headers: accept }))).headers.get(
      'cache-control',
    ),
  ).toBe('private, no-store')
})

test("markdown follows the page's Vary on Accept-Language, since the handler forwards it", async () => {
  upstream = () =>
    new Response(page('<h1>Hallo</h1>'), {
      headers: {
        'content-type': 'text/html',
        vary: 'RSC, Accept-Language',
        'cache-control': 'public, max-age=60',
      },
    })
  const response = await handler(
    new Request(`${site}/hello.md`, { headers: { 'accept-language': 'de' } }),
  )
  expect(response.headers.get('vary')).toBe('Accept, Accept-Language')
  upstream = () => new Response(page('<h1>Hi</h1>'), { headers: { 'content-type': 'text/html' } })
  expect((await handler(new Request(`${site}/hello.md`))).headers.get('vary')).toBe('Accept')
})

// an upstream that redirects to location
const redirect =
  (location: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(null, { status: 307, headers: { location, ...headers } })

test('a same-origin redirect stays on the site in markdown, varies on Accept, and is private when credentialed', async () => {
  // a return-to check passes /.//evil.test/x as same-origin; its twin must never read as //evil.test
  for (const location of [
    '/.//evil.test/x',
    '/..//evil.test/x',
    '/a/..//evil.test/x',
    '/./\\evil.test/x',
  ]) {
    upstream = redirect(location)
    const to = (await get('/go')).headers.get('location')!
    expect({ location, origin: new URL(to, site).origin }).toEqual({ location, origin: site })
  }
  upstream = redirect('/login?next=%2Fcart', { 'cache-control': 'public, max-age=60' })
  const plain = await get('/go')
  expect(plain.headers.get('location')).toBe('/login.md?next=%2Fcart')
  expect([plain.headers.get('vary'), plain.headers.get('cache-control')]).toEqual([
    'Accept',
    'public, max-age=60',
  ])
  expect((await get('/go', { cookie: 'sid=1' })).headers.get('cache-control')).toBe(
    'private, no-store',
  )
  upstream = redirect('/login', { 'set-cookie': 'flash=1' })
  expect((await get('/go')).headers.get('cache-control')).toBe('private, no-store')
  // another origin is passed on as it came
  upstream = redirect('https://idp.test/authorize')
  expect((await get('/go')).headers.get('location')).toBe('https://idp.test/authorize')
})

// what next 16.3.0 and 16.4.3 stream for a redirect() after the layout's shell went out: a 200, the shell, the
// redirect's digest in the flight data as written (only the meta html-escapes it), and a refresh meta (a next start
// capture, trimmed)
const streamedRedirect =
  (url: string, delay = 1, status = 307) =>
  () =>
    new Response(
      `<!DOCTYPE html><html><head><title>Site</title></head><body><header><h1>Site header</h1></header><main><!--$?--><template id="B:0"></template><p>Loading…</p><!--/$--></main>` +
        `<script>self.__next_f.push([1,"5:E{\\"digest\\":\\"NEXT_REDIRECT;replace;${url.replaceAll('&amp;', '&')};${status};\\"}\\n"])</script>` +
        `<meta id="__next-page-redirect" http-equiv="refresh" content="${delay};url=${url}"/></body></html>`,
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=60',
        },
      },
    )

test("a redirect() streamed after the shell is a redirect to the target's .md, not the half page", async () => {
  upstream = streamedRedirect('/target?from=late&amp;x=1')
  const late = await handler(new Request(`${site}/r/late.md`))
  expect([late.status, late.headers.get('location'), await late.text()]).toEqual([
    307,
    '/target.md?from=late&x=1',
    '',
  ])
  expect(late.headers.get('vary')).toBe('Accept')
  // permanentRedirect() refreshes after 0 seconds
  upstream = streamedRedirect('/', 0, 308)
  const gone = await handler(new Request(`${site}/gone.md`))
  expect([gone.status, gone.headers.get('location')]).toEqual([308, '/index.md'])
  // the same rules as a redirect with its own status: cached as the page is, private when credentialed or negotiated
  expect(gone.headers.get('cache-control')).toBe('public, max-age=60')
  upstream = streamedRedirect('/target')
  const signedIn = await handler(new Request(`${site}/r/late.md`, { headers: { cookie: 'sid=1' } }))
  expect(signedIn.headers.get('cache-control')).toBe('private, no-store')
  const negotiated = await handler(
    new Request(`${site}/r/late`, { headers: { accept: 'text/markdown' } }),
  )
  expect([negotiated.status, negotiated.headers.get('cache-control')]).toEqual([
    307,
    'private, no-store',
  ])
  // a twin path that starts with //host stays a path on this site
  upstream = streamedRedirect('/.//evil.test/x')
  const sneaky = (await handler(new Request(`${site}/r/late.md`))).headers.get('location')!
  expect(new URL(sneaky, site).origin).toBe(site)
  // another origin is passed on as it came, never made a .md of ours or followed
  upstream = streamedRedirect('https://evil.test/x')
  const away = await handler(new Request(`${site}/r/away.md`))
  expect([away.status, away.headers.get('location')]).toEqual([307, 'https://evil.test/x'])
  expect(seen.map((call) => call.url.pathname)).toEqual([
    '/r/late',
    '/gone',
    '/r/late',
    '/r/late',
    '/r/late',
    '/r/away',
  ])
})

test("a page that only shows next's redirect meta as text, or a refresh meta of its own, is converted", async () => {
  upstream = () =>
    new Response(
      page(
        '<h1>Docs</h1><pre><code>&lt;meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/x"/&gt;</code></pre>' +
          '<meta http-equiv="refresh" content="1;url=/elsewhere">',
      ),
      { headers: { 'content-type': 'text/html' } },
    )
  const response = await get('/docs')
  expect(response.status).toBe(200)
  expect(response.headers.has('location')).toBe(false)
  expect(await response.text()).toContain('# Docs')
})

// next start captures (fixtures/streamed-fallback.capture.md): a 200, the shell, and the error as react's $RX
const streamedFallback =
  (file: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60',
        ...headers,
      },
    })

test.each([
  ['streamed-not-found-next16.3.html', 404, 'Not found'],
  ['streamed-not-found-next16.4.html', 404, 'Not found'],
  ['streamed-not-found-cache-components.html', 404, 'Not found'],
  ['streamed-forbidden-next16.4.html', 403, 'Forbidden'],
  ['streamed-unauthorized-next16.3.html', 401, 'Unauthorized'],
  ['streamed-not-found-static-next16.3.html', 404, 'Not found'],
])(
  'a notFound(), forbidden() or unauthorized() streamed after the shell (%s) is a %i, not the shell',
  async (file, status, title) => {
    upstream = streamedFallback(file)
    const response = await handler(new Request(`${site}/nope.md`))
    expect([response.status, await response.text()]).toEqual([status, `# ${title}\n`])
    expect([response.headers.get('cache-control'), response.headers.get('vary')]).toEqual([
      'private, no-store',
      'Accept',
    ])
    expect(response.headers.has('x-affordances-md-personal')).toBe(false)
    // the same as a thrown one: someone's credentials, or a cookie set in answer, mark it personal
    const signedIn = await handler(new Request(`${site}/nope.md`, { headers: { cookie: 'sid=1' } }))
    expect([signedIn.status, signedIn.headers.get('x-affordances-md-personal')]).toEqual([
      status,
      '1',
    ])
    upstream = streamedFallback(file, { 'set-cookie': 'flash=1' })
    expect(
      (await handler(new Request(`${site}/nope.md`))).headers.get('x-affordances-md-personal'),
    ).toBe('1')
    // asked for with Accept at the page's url, too
    upstream = streamedFallback(file)
    const negotiated = await handler(
      new Request(`${site}/nope`, { headers: { accept: 'text/markdown' } }),
    )
    expect([negotiated.status, negotiated.headers.get('cache-control')]).toEqual([
      status,
      'private, no-store',
    ])
  },
)

test('a page that streamed a notFound() fills none of its slots', async () => {
  upstream = streamedFallback('streamed-not-found-next16.4.html')
  const ran = markdownModule({ slots: { readme: () => '## Readme' } })
  const response = await handler(new Request(`${site}/x/missing.md`))
  expect(response.status).toBe(404)
  expect(ran).toEqual([])
})

test('markdown asked for with Accept at the page url is never cached publicly; the .md url mirrors the page', async () => {
  upstream = () =>
    new Response(page('<h1>Home</h1>'), {
      headers: { 'content-type': 'text/html', 'cache-control': 'public, s-maxage=31536000' },
    })
  const negotiated = await handler(
    new Request(`${site}/`, { headers: { accept: 'text/markdown' } }),
  )
  expect(negotiated.headers.get('cache-control')).toBe('private, no-store')
  const twin = await handler(new Request(`${site}/index.md`))
  expect(twin.headers.get('cache-control')).toBe('public, s-maxage=31536000')
})

test("a file passed through never carries a cookie set for the headers option's credentials, and is private when credentialed", async () => {
  upstream = () =>
    new Response('<rss/>', {
      headers: [
        ['content-type', 'application/rss+xml'],
        ['cache-control', 'public, max-age=60'],
        ['set-cookie', 'session=svc-refreshed'],
      ],
    })
  const service = createMdHandler({ headers: { cookie: 'session=svc' } })
  const anonymous = await service(new Request(`${site}/feed.md`))
  expect(anonymous.headers.getSetCookie()).toEqual([])
  expect(anonymous.headers.get('cache-control')).toBe('private, no-store')
  const person = await handler(
    new Request(`${site}/feed.md`, { headers: { cookie: 'session=alice' } }),
  )
  expect(person.headers.get('cache-control')).toBe('private, no-store')
  const plain = await handler(new Request(`${site}/feed.md`))
  expect([plain.headers.get('cache-control'), plain.headers.getSetCookie()]).toEqual([
    'public, max-age=60',
    ['session=svc-refreshed'],
  ])
})

test('a file passed through streams to the end, however long past the timeout', async () => {
  // a real fetch's body errors once its signal aborts
  upstream = (_, init) => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal!.addEventListener('abort', () => controller.error(new Error('aborted')))
        controller.enqueue(encoder.encode('first half, '))
        setTimeout(() => {
          controller.enqueue(encoder.encode('second half'))
          controller.close()
        }, 60)
      },
    })
    return new Response(body, { headers: { 'content-type': 'application/pdf' } })
  }
  const response = await createMdHandler({ timeout: 20 })(new Request(`${site}/manual.pdf.md`))
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('first half, second half')
})

test('a page still streaming at the timeout is converted as far as it got, never cached', async () => {
  upstream = stalls([
    '<html><head><title>Tee</title></head><body><main><h1>Tee</h1>',
    '<!--$?--><template id="B:0"></template><p>Loading price…</p><!--/$-->',
    '<!--$?--><template id="B:1"></template><p>Loading stock…</p><!--/$--></main>',
    '<div hidden id="S:0"><p>$48</p></div><script>$RC("B:0","S:0")</script>',
  ])
  const response = await createMdHandler({ timeout: 50 })(
    new Request(`${site}/api/affordances/md/tee`),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get(PARTIAL_HEADER)).toBe('1')
  const markdown = await response.text()
  expect(markdown).toContain('$48')
  expect(markdown).toContain('Loading stock…')
  expect(markdown).not.toContain('Loading price…')
  expect(
    markdown
      .trim()
      .endsWith(
        '> Some of this page was still loading after 50ms and is missing or shown as its loading state.',
      ),
  ).toBe(true)

  // headers, but nothing of the page by the deadline: still too slow
  upstream = stalls([])
  expect(
    (await createMdHandler({ timeout: 20 })(new Request(`${site}/api/affordances/md/tee`))).status,
  ).toBe(504)
})

test('origin override and append', async () => {
  const proxied = createMdHandler({
    origin: 'http://internal:3000',
    append: () => '## Actions\n\n- addToCart',
  })
  const response = await proxied(new Request(`${site}/api/affordances/md/a`))
  expect(seen[0]!.url.href).toBe('http://internal:3000/a')
  expect(await response.text()).toMatch(/Boxy\.\n\n## Actions\n\n- addToCart\n$/)
})

test('rewrites send only markdown requests, never our own render or an RSC fetch, and skip api', () => {
  const [, pageRule] = rewrites.beforeFiles
  const re = new RegExp(`^/${pageRule!.source.slice('/:path'.length)}$`)
  expect(re.test('/blog/post')).toBe(true)
  // a dot isn't a file extension: package versions and names
  expect(re.test('/version/5.3.0')).toBe(true)
  expect(re.test('/package/chart.js')).toBe(true)
  expect(re.test('/api/affordances/md/x')).toBe(false)
  expect(re.test('/_next/static/a.js')).toBe(false)
  // .md is afterFiles' job, so a real .md file in public/ wins
  expect(re.test('/blog/post.md')).toBe(false)
  for (const rule of rewrites.beforeFiles)
    expect(rule.missing).toEqual([
      { type: 'header', key: RENDER_HEADER },
      { type: 'header', key: 'rsc' },
      { type: 'query', key: '_rsc' },
    ])
  for (const rule of rewrites.afterFiles)
    expect(rule.missing).toEqual([{ type: 'header', key: RENDER_HEADER }])
})

// next's own matching, to hold mdRewrite to the rewrites it copies for proxy.ts, and to fill in Link values
const require = createRequire(import.meta.url)
const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match.js') as {
  getPathMatch: (source: string) => (pathname: string) => Record<string, unknown> | false
}
const { compileNonPath, matchHas } =
  require('next/dist/shared/lib/router/utils/prepare-destination.js') as {
    compileNonPath: (value: string, params: Record<string, unknown>) => string
    matchHas: (
      req: { headers: Record<string, string> },
      query: object,
      has?: Has[],
      missing?: Has[],
    ) => unknown
  }
const nextRewrites = (path: string, headers: Record<string, string>) => {
  const { pathname, searchParams } = new URL(path, site)
  const query = Object.fromEntries(searchParams)
  return ([...rewrites.beforeFiles, ...rewrites.afterFiles] as Rewrite[]).some(
    (rule) =>
      getPathMatch(rule.source)(pathname) &&
      matchHas({ headers }, query, rule.has, rule.missing) !== false,
  )
}

test('mdRewrite matches exactly what the rewrites match', () => {
  const markdown = { accept: 'text/markdown' }
  const cases: [string, Record<string, string>][] = [
    ['/', markdown],
    ['/', {}],
    ['/index.md', {}],
    ['/INDEX.MD', {}],
    ['/pricing.md', {}],
    ['/pricing.MD', {}],
    ['/blog/post', markdown],
    ['/blog/post', { accept: 'text/html' }],
    ['/blog/post', { accept: 'text/html, text/markdown;q=0.9' }],
    ['/blog/post.md', markdown],
    ['/version/5.3.0', markdown],
    ['/dashboard/x.Y', markdown],
    ['/api/x', markdown],
    ['/API/x', markdown],
    ['/api', markdown],
    ['/_next/static/a.js', markdown],
    ['/_NEXT/static/a.js', markdown],
    ['/a/.md', {}],
    ['/.md', {}],
    ['/blog/post', { ...markdown, rsc: '1' }],
    // next takes the RSC header from a proxy.ts, but not always the _rsc param
    ['/blog/post?_rsc=abc', markdown],
    ['/blog/post?_rsc=', markdown],
    ['/blog/post?x=1', markdown],
    ['/blog/post', { ...markdown, [RENDER_HEADER]: '1' }],
    ['/blog/post.md', { [RENDER_HEADER]: '1' }],
  ]
  for (const [pathname, headers] of cases)
    expect({
      pathname,
      headers,
      matched: isMdRequest(new Request(`${site}${pathname}`, { headers })),
    }).toEqual({ pathname, headers, matched: nextRewrites(pathname, headers) })
})

test('an RSC fetch is never markdown, even when it asks for it', () => {
  const at = (path: string) =>
    mdRewrite(new Request(`${site}${path}`, { headers: { accept: 'text/markdown' } }))?.href
  expect(at('/pricing?_rsc=abc')).toBeUndefined()
  expect(at('/?_rsc=abc')).toBeUndefined()
  expect(at('/pricing')).toBe(`${site}/api/affordances/md/pricing`)
  expect(at('/pricing?x=1')).toBe(`${site}/api/affordances/md/pricing?x=1`)
})

const linkFor = (path: string, headers: Record<string, string> = {}) =>
  mdLink(new Request(`${site}${path}`, { headers }))

test("mdLink gives a page's Link value for its public url, and nothing for what isn't a page", () => {
  const scoped = '/registry/upstream/npm/package/@babel/core/version/8.1.0'
  expect(linkFor(scoped)).toBe(`<${scoped}.md>; rel="alternate"; type="text/markdown"`)
  expect(linkFor('/')).toBe('</index.md>; rel="alternate"; type="text/markdown"')
  expect(linkFor('/blog/post/?x=1')).toBe('</blog/post.md>; rel="alternate"; type="text/markdown"')
  expect(linkFor('/blog/post', { accept: 'text/html' })).toBeDefined()
  for (const [path, headers] of [
    ['/api/x', {}],
    ['/api', {}],
    ['/_next/static/a.js', {}],
    ['/x.md', {}],
    ['/index.md', {}],
    ['/x', { accept: 'text/markdown' }],
    ['/x?_rsc=abc', {}],
    ['/x', { rsc: '1' }],
    ['/x', { [RENDER_HEADER]: '1' }],
  ] as const)
    expect({ path, link: linkFor(path, headers) }).toEqual({ path, link: undefined })
})

test("md()'s Link never lands on api routes or next's internals, even under a root catch-all", async () => {
  const rules = await md({
    root: app([
      'app/[...slug]/page.tsx',
      'app/[team]/settings/page.tsx',
      'app/docs/[[...page]]/page.tsx',
    ]),
  })({} as Config).headers!()
  for (const path of [
    '/api/cart',
    '/api',
    '/_next/static/chunks/a.js',
    '/api/settings',
    '/_next/settings',
  ])
    expect({ path, link: linkOn(rules, path) }).toEqual({ path, link: undefined })
  expect(linkOn(rules, '/guide/intro')).toBe(alternate('/guide/intro.md'))
  expect(linkOn(rules, '/acme/settings')).toBe(alternate('/acme/settings.md'))
  expect(linkOn(rules, '/apiary')).toBe(alternate('/apiary.md'))
  expect(linkOn(rules, '/docs/a')).toBe(alternate('/docs/a.md'))
})

test('mdLink never points off the site, whatever slashes the path starts with', () => {
  for (const path of [
    '//evil.test/phish',
    '/.//evil.test/x',
    '/..//evil.test/x',
    '/a/..//evil.test/x',
    '/./\\evil.test/x',
  ])
    expect({ path, link: linkFor(path) }).toEqual({ path, link: undefined })
  expect(linkFor('/a//b')).toBe('</a//b.md>; rel="alternate"; type="text/markdown"')
})

test("next's internals and api routes never reach the handler's rewrites", () => {
  for (const path of ['/_next/static/x.md', '/_next/image.md', '/api/x.md', '/API/cart.md'])
    expect({ path, rewrite: mdRewrite(new Request(`${site}${path}`)) }).toEqual({
      path,
      rewrite: undefined,
    })
  expect(mdRewrite(new Request(`${site}/guide.md`))?.pathname).toBe('/api/affordances/md/guide')
  expect(mdRewrite(new Request(`${site}/apiary.md`))?.pathname).toBe('/api/affordances/md/apiary')
})

test('mdRewrite gives the handler url, which maps back to the page', () => {
  const at = (path: string, headers: Record<string, string> = {}) =>
    mdRewrite(new Request(`${site}${path}`, { headers }))?.href
  expect(at('/blog/post.md?x=1')).toBe(`${site}/api/affordances/md/blog/post?x=1`)
  expect(at('/index.md')).toBe(`${site}/api/affordances/md`)
  expect(at('/', { accept: 'text/markdown' })).toBe(`${site}/api/affordances/md`)
  expect(at('/blog/post')).toBeUndefined()
  expect(mdPagePath('/api/affordances/md/a')).toBe('/a')
  expect(mdPagePath('/api/affordances/mdx')).toBe('/api/affordances/mdx')
  expect(mdPagePath('/pricing.MD')).toBe('/pricing')
  expect(mdPagePath('/docs/Index.md')).toBe('/docs/')
})

test('a path that starts with //host never leaves the origin', async () => {
  const response = await get('//evil.example/x', { cookie: 'sid=1' })
  expect(response.status).toBe(400)
  expect(seen).toHaveLength(0)
})

test("a passthrough sends only the page's own headers, never the headers option's credentials, and keeps credentialed responses private", async () => {
  upstream = () =>
    new Response('0:[]\n', {
      headers: [
        ['content-type', 'text/x-component'],
        ['cache-control', 'public, max-age=60'],
        ['set-cookie', 'session=refreshed'],
      ],
    })
  const service = createMdHandler({ headers: { cookie: 'session=svc', 'x-bypass': 'b' } })
  const rsc = (headers: Record<string, string> = {}) =>
    service(new Request(`${site}/feed`, { headers: { rsc: '1', ...headers } }))

  // anonymous: the option's cookie is never sent, and a cookie the page sets in answer never goes out
  const anonymous = await rsc({
    'user-agent': 'agent/1',
    'if-none-match': '"v1"',
    'next-router-segment-prefetch': '/_tree',
    'x-forwarded-host': 'evil.test',
    'x-middleware-subrequest': 'proxy',
    'x-custom-auth': 'internal',
  })
  const sent = seen[0]!.headers
  expect(sent.has('cookie')).toBe(false)
  expect(sent.get('x-bypass')).toBe('b')
  expect(sent.get('user-agent')).toBe('agent/1')
  expect(sent.get('if-none-match')).toBe('"v1"')
  expect(sent.get('next-router-segment-prefetch')).toBe('/_tree')
  for (const name of ['x-forwarded-host', 'x-middleware-subrequest', 'x-custom-auth'])
    expect({ name, sent: sent.has(name) }).toEqual({ name, sent: false })
  // the option's credentials never went, so this answer is the page's own to an anonymous request, cookie and all
  expect(anonymous.headers.getSetCookie()).toEqual(['session=refreshed'])
  expect(anonymous.headers.get('cache-control')).toBe('public, max-age=60')

  // a person's own request carries their own cookie, never the service's, and stays private
  seen = []
  const person = await rsc({ cookie: 'session=alice' })
  expect(seen[0]!.headers.get('cookie')).toBe('session=alice')
  expect(person.headers.get('cache-control')).toBe('private, no-store')

  // without credentials anywhere, the page's own caching and cookies pass as they came
  seen = []
  const plain = await handler(new Request(`${site}/feed`, { headers: { rsc: '1' } }))
  expect(plain.headers.get('cache-control')).toBe('public, max-age=60')
  expect(plain.headers.getSetCookie()).toEqual(['session=refreshed'])
})

test("a page a proxy.ts rewrote is passed on without next's x-middleware-* headers, which a route handler can't send", async () => {
  const proxied = {
    'x-middleware-rewrite': '/real-pricing',
    'x-middleware-next': '1',
    'x-middleware-set-cookie': 'a=1',
    'x-nextjs-rewritten-path': '/real-pricing',
  }
  upstream = () =>
    new Response('0:["$","div",null,{}]\n', {
      headers: { 'content-type': 'text/x-component', ...proxied },
    })
  // an RSC request that also asks for markdown, as a proxy.ts that rewrites with mdRewrite sends one here
  const rsc = await handler(
    new Request(`${site}/pricing?_rsc`, { headers: { rsc: '1', accept: 'text/markdown' } }),
  )
  // and a file the handler passes through as it came
  upstream = () =>
    new Response('{}', { headers: { 'content-type': 'application/json', ...proxied } })
  const file = await get('/data.json')
  for (const response of [rsc, file]) {
    expect(response.status).toBe(200)
    expect([...response.headers.keys()].filter((name) => name.startsWith('x-middleware-'))).toEqual(
      [],
    )
    expect(response.headers.get('x-nextjs-rewritten-path')).toBe('/real-pricing')
  }
  expect(await rsc.text()).toBe('0:["$","div",null,{}]\n')
})

test("an RSC fetch the proxy sent here gets the page's own RSC payload, unconverted", async () => {
  upstream = () =>
    new Response('0:["$","div",null,{}]\n', {
      status: 200,
      headers: [
        ['content-type', 'text/x-component'],
        ['vary', 'RSC, Next-Router-State-Tree, Next-Router-Prefetch'],
        ['set-cookie', 'a=1'],
        ['set-cookie', 'b=2'],
        ['content-encoding', 'gzip'],
        ['content-length', '99'],
      ],
    })
  const response = await handler(
    new Request(`${site}/api/affordances/md/pricing?_rsc=abc`, {
      headers: {
        rsc: '1',
        accept: 'text/markdown',
        'next-router-state-tree': '%5B%22%22%5D',
        'next-router-prefetch': '1',
        'next-url': '/pricing',
        cookie: 'sid=1',
        connection: 'keep-alive, x-hop',
        'x-hop': 'no',
      },
    }),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/x-component')
  expect(await response.text()).toBe('0:["$","div",null,{}]\n')
  expect(response.headers.get('vary')).toBe('RSC, Next-Router-State-Tree, Next-Router-Prefetch')
  expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
  expect(response.headers.has('content-encoding')).toBe(false)
  expect(response.headers.has('content-length')).toBe(false)
  const [call] = seen
  expect(seen).toHaveLength(1)
  expect(call!.url.href).toBe(`${site}/pricing?_rsc=abc`)
  expect(Object.fromEntries(call!.headers)).toEqual({
    rsc: '1',
    accept: 'text/markdown',
    'next-router-state-tree': '%5B%22%22%5D',
    'next-router-prefetch': '1',
    'next-url': '/pricing',
    cookie: 'sid=1',
    [RENDER_HEADER]: '1',
  })

  // a status and a redirect come back as they are, not as markdown's
  upstream = () => new Response(null, { status: 307, headers: { location: '/login' } })
  const redirected = await get('/pricing', { rsc: '1' })
  expect(redirected.status).toBe(307)
  expect(redirected.headers.get('location')).toBe('/login')

  // the loop guard and the timeout still hold
  expect((await get('/pricing', { rsc: '1', [RENDER_HEADER]: '1' })).status).toBe(508)
  vi.stubGlobal(
    'fetch',
    (_: URL, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  )
  const slow = await createMdHandler({ timeout: 20 })(
    new Request(`${site}/pricing`, { headers: { rsc: '1' } }),
  )
  expect(slow.status).toBe(504)
})

// a literalMd route, /x/:pkg, where the package readme.md is a page of its own and express isn't one named .md
const literally = (pages: Record<string, number>) => {
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/x/:pkg']))
  upstream = (url) => {
    const status = pages[url.pathname] ?? 404
    return new Response(page(`<h1>${url.pathname}</h1>`), {
      status,
      headers: { 'content-type': 'text/html', ...(status === 302 && { location: '/login' }) },
    })
  }
}
afterEach(() => vi.unstubAllEnvs())

test('on a literalMd route, a .md page that exists is itself: passed through, or converted for markdown', async () => {
  literally({ '/x/readme.md': 200, '/x/readme': 200 })
  const html = await handler(
    new Request(`${site}/x/readme.md?tab=1`, { headers: { cookie: 'sid=1' } }),
  )
  expect(html.status).toBe(200)
  expect(html.headers.get('content-type')).toBe('text/html')
  expect(await html.text()).toContain('<h1>/x/readme.md</h1>')
  expect(html.headers.get('link')).toBe(alternate('/x/readme.md.md'))
  expect(seen.map((call) => call.url.pathname + call.url.search)).toEqual(['/x/readme.md?tab=1'])
  expect(seen[0]!.headers.get('cookie')).toBe('sid=1')
  expect(seen[0]!.headers.get(RENDER_HEADER)).toBe('1')

  seen = []
  const markdown = await handler(
    new Request(`${site}/x/readme.md`, { headers: { accept: 'text/markdown' } }),
  )
  expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
  expect(await markdown.text()).toContain('# /x/readme.md')
  expect(seen.map((call) => call.url.pathname)).toEqual(['/x/readme.md'])
  // the proxy's handler url, which keeps the .md
  seen = []
  await handler(new Request(`${site}/api/affordances/md/x/readme.md`))
  expect(seen.map((call) => call.url.pathname)).toEqual(['/x/readme.md'])
})

test('on a literalMd route, a .md page that 404s is a twin: the markdown of the page without it', async () => {
  literally({ '/x/express': 200, '/x/readme.md': 200 })
  for (const headers of [{}, { accept: 'text/markdown' }] as Record<string, string>[]) {
    seen = []
    const twin = await handler(new Request(`${site}/x/express.md?v=1`, { headers }))
    expect(twin.status).toBe(200)
    expect(twin.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await twin.text()).toContain('# /x/express')
    expect(seen.map((call) => call.url.pathname + call.url.search)).toEqual([
      '/x/express.md?v=1',
      '/x/express?v=1',
    ])
  }
  // readme.md's own twin
  seen = []
  const twice = await handler(new Request(`${site}/x/readme.md.md`))
  expect(await twice.text()).toContain('# /x/readme.md')
  expect(seen.map((call) => call.url.pathname)).toEqual(['/x/readme.md.md', '/x/readme.md'])
  // neither exists: the twin's own 404
  expect((await handler(new Request(`${site}/x/nope.md`))).status).toBe(404)
})

test('on a literalMd route, any answer but a 404 is the page: a redirect or an error never falls back', async () => {
  literally({ '/x/moved.md': 302, '/x/broken.md': 500, '/x/moved': 200, '/x/broken': 200 })
  for (const headers of [{}, { accept: 'text/markdown' }] as Record<string, string>[]) {
    seen = []
    const moved = await handler(new Request(`${site}/x/moved.md`, { headers }))
    expect(moved.status).toBe(302)
    const broken = await handler(new Request(`${site}/x/broken.md`, { headers }))
    expect(broken.status).toBe(500)
    expect(seen.map((call) => call.url.pathname)).toEqual(['/x/moved.md', '/x/broken.md'])
  }
  // the markdown request's redirect stays in markdown, as anywhere else
  const moved = await handler(
    new Request(`${site}/x/moved.md`, { headers: { accept: 'text/markdown' } }),
  )
  expect(moved.headers.get('location')).toBe('/login.md')
})

test('off a literalMd route, a .md path is a twin with one fetch, as before', async () => {
  literally({ '/blog/post': 200, '/x/a/b': 200 })
  await handler(new Request(`${site}/blog/post.md`))
  await handler(new Request(`${site}/x/a/b.md`))
  expect(seen.map((call) => call.url.pathname)).toEqual(['/blog/post', '/x/a/b'])
  // without literalMd, /x/readme.md is a twin too
  vi.unstubAllEnvs()
  seen = []
  await handler(new Request(`${site}/x/readme.md`))
  expect(seen.map((call) => call.url.pathname)).toEqual(['/x/readme'])
})

test("mdRewrite sends a literalMd route's .md path to the handler as it is", () => {
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/x/:pkg']))
  const at = (path: string, headers: Record<string, string> = {}) =>
    mdRewrite(new Request(`${site}${path}`, { headers }))?.href
  expect(at('/x/readme.md')).toBe(`${site}/api/affordances/md/x/readme.md`)
  expect(at('/x/readme.md', { accept: 'text/markdown' })).toBe(
    `${site}/api/affordances/md/x/readme.md`,
  )
  expect(at('/x/readme.md.md?a=1')).toBe(`${site}/api/affordances/md/x/readme.md.md?a=1`)
  expect(at('/blog/post.md')).toBe(`${site}/api/affordances/md/blog/post`)
  expect(at('/x/readme.md', { [RENDER_HEADER]: '1' })).toBeUndefined()
})

test("sourceRegex matches a .md path exactly when next's own matcher does", () => {
  const sources = [
    '/registry/:registry/npm/package/:pkg',
    '/x/:pkg',
    '/x/:pkg?',
    '/x/:pkg*',
    '/x/:pkg+',
    '/x/:pkg(\\d+)',
    '/x/:pkg([a-z]+\\.md)',
    '/x/:a/:b?',
    '/x/:pkg(.*)',
    '/docs/:slug*',
    '/x/:pkg((?:@[^/]+/)?[^/]+)',
    '/X/:pkg',
    '/x-:pkg',
    '/x/(.*)',
    '/x/(.*)?',
    '/x{/:pkg}?',
    '/x{/:pkg}*',
    '/x{-:a}?/:b',
    '/x/:a-:b',
    '/x/:pkg.md',
    '/x.:ext?',
    '/x/\\(:pkg\\)',
    '/x/{readme}?.md',
  ]
  const paths = [
    '/x/readme.md',
    '/x/a/b.md',
    '/x/abc.md',
    '/X/readme.md',
    '/x/@babel/core.md',
    '/registry/upstream/npm/package/readme.md',
    '/registry/upstream/npm/package/@babel/core.md',
    '/x-foo.md',
    '/docs/a/b/c.md',
    '/docs.md',
    '/x/Readme.MD',
    '/x/a%2Fb.md',
    '/x/ü.md',
    '/y/readme.md',
    '/x/a-b.md',
    '/x/(readme).md',
    '/x/.md',
    '/x.md',
    '/x-a/readme.md',
  ]
  for (const source of sources)
    for (const path of paths)
      expect({ source, path, matched: sourceRegex(source).test(path) }).toEqual({
        source,
        path,
        matched: getPathMatch(source)(path) !== false,
      })
})

const rewrittenTo = (path: string) => mdRewrite(new Request(`${site}${path}`))?.pathname

test('literalMd routes follow the env they were compiled from, and a trailing / never matches', () => {
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/x/:pkg']))
  expect(rewrittenTo('/x/readme.md')).toBe('/api/affordances/md/x/readme.md')
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/y/:pkg']))
  expect(rewrittenTo('/x/readme.md')).toBe('/api/affordances/md/x/readme')
  expect(rewrittenTo('/y/readme.md')).toBe('/api/affordances/md/y/readme.md')
  // next's matcher isn't strict about a trailing /, ours is; next 308s /x/ to /x before any rewrite, and a literal
  // path has to end in .md anyway
  expect(getPathMatch('/y/:pkg')('/y/readme.md/')).not.toBe(false)
  expect(sourceRegex('/y/:pkg').test('/y/readme.md/')).toBe(false)
  expect(rewrittenTo('/y/readme.md/')).toBeUndefined()
})

test("a folder name with path-to-regexp's characters is matched as itself, never as a pattern", async () => {
  const rules = await md({
    root: app([
      'app/x(.*)/page.tsx',
      'app/p:id/page.tsx',
      'app/star*/page.tsx',
      'app/g{a}?/page.tsx',
      'app/w+/[slug]/page.tsx',
      'app/plus+/page.tsx',
    ]),
  })({} as Config).headers!()
  for (const path of ['/x(.*)', '/p:id', '/star*', '/plus+'])
    expect(linkOn(rules, path)).toBe(alternate(`${path}.md`))
  // a ? can't stand in a url's path as itself
  expect(linkOn(rules, '/g{a}?')).toBe(alternate('/g{a}%3F.md'))
  expect(linkOn(rules, '/w+/a')).toBe(alternate('/w+/a.md'))
  // characters a url can't hold as they are go out encoded
  const odd = await md({ root: app(['app/w/q?z/page.tsx']) })({} as Config).headers!()
  expect(odd.flatMap((rule) => rule.headers.map((h) => h.value))).toEqual([
    alternate('/w/q%3Fz.md'),
  ])
  for (const path of [
    '/xyz',
    '/x',
    '/p',
    '/pid',
    '/star',
    '/starstar',
    '/g',
    '/ga',
    '/w/a',
    '/ww/a',
  ])
    expect({ path, link: linkOn(rules, path) }).toEqual({ path, link: undefined })
})

test('a literalMd source next would reject fails at config time', () => {
  for (const source of ['/x/:', '/x/(?:a)', '/x/((a))', '/x/(a', '/x{/:pkg', '/x/:a:b']) {
    expect(() => getPathMatch(source)).toThrow(TypeError)
    expect(() => md({ root, literalMd: [source] })({} as Config)).toThrow(TypeError)
  }
})

// the app's markdown.ts files, as md()'s generated module would give them to the handler: the tests' routes module,
// which vitest.config.ts aliases @affordances/md/routes to
const clear = () => {
  for (const route of Object.keys(authored)) delete authored[route]
}
afterEach(clear)
const markdownFiles = (
  routes: Record<
    string,
    (args: {
      params: Record<string, string | string[]>
      searchParams: URLSearchParams
      request: Request
    }) => unknown
  >,
) => {
  const calls: { route: string; params: unknown }[] = []
  clear()
  Object.assign(
    authored,
    Object.fromEntries(
      Object.entries(routes).map(([route, markdown]) => [
        route,
        async () => ({
          default: (args: Parameters<typeof markdown>[0]) => {
            calls.push({ route, params: args.params })
            return markdown(args) as never
          },
        }),
      ]),
    ),
  )
  return calls
}

test("a route's markdown.ts gives its markdown without rendering the page", async () => {
  const calls = markdownFiles({
    '/blog/[slug]': ({ params, searchParams }) =>
      `# Post ${params.slug}\n\nTab ${searchParams.get('tab')}.`,
  })
  const response = await createMdHandler({ append: () => '## More' })(
    new Request(`${site}/blog/hello.md?tab=2`),
  )
  expect(seen).toHaveLength(0)
  expect(calls).toEqual([{ route: '/blog/[slug]', params: { slug: 'hello' } }])
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
  expect(response.headers.get('link')).toBe(`<${site}/blog/hello?tab=2>; rel="canonical"`)
  const text = await response.text()
  expect(text).toBe(
    `---\ntitle: "Post hello"\nurl: "${site}/blog/hello?tab=2"\n---\n\n# Post hello\n\nTab 2.\n\n## More\n`,
  )
  expect(response.headers.get('x-affordances-tokens')).toBe(String(Math.ceil(text.length / 4)))
  // it read data with whatever the request carried, which may be a key the handler can't recognise: never cached
  // unless the author says so with a Response
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Accept')

  // the Accept path reaches it too, and the request it gets is the visitor's
  let request: Request | undefined
  markdownFiles({
    '/blog/[slug]': (args) => {
      request = args.request
      return { markdown: '# Hi', title: 'A title', description: 'About it' }
    },
  })
  const asked = await handler(
    new Request(`${site}/blog/hello`, { headers: { accept: 'text/markdown', cookie: 'sid=1' } }),
  )
  expect(await asked.text()).toBe(
    `---\ntitle: "A title"\ndescription: "About it"\nurl: "${site}/blog/hello"\n---\n\n# Hi\n`,
  )
  expect(request!.headers.get('cookie')).toBe('sid=1')
  expect(asked.headers.get('cache-control')).toBe('private, no-store')
  expect(seen).toHaveLength(0)
})

test("a markdown.ts Response is passed on, kept private with credentials; undefined falls back to the page's html", async () => {
  markdownFiles({
    '/gone': () =>
      new Response('# Gone\n', { status: 410, headers: { 'cache-control': 'public, max-age=60' } }),
    '/later': () => undefined,
  })
  const gone = await handler(new Request(`${site}/gone.md`))
  expect([gone.status, gone.headers.get('cache-control'), await gone.text()]).toEqual([
    410,
    'public, max-age=60',
    '# Gone\n',
  ])
  expect(
    (
      await handler(new Request(`${site}/gone.md`, { headers: { authorization: 'Bearer x' } }))
    ).headers.get('cache-control'),
  ).toBe('private, no-store')
  expect(seen).toHaveLength(0)

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await (await handler(new Request(`${site}/later.md`))).text()).toContain('# Tee')
  expect(seen.map((call) => call.url.pathname)).toEqual(['/later'])
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('/later/markdown.ts returned nothing'))
  warn.mockClear()
  vi.stubEnv('NODE_ENV', 'production')
  await handler(new Request(`${site}/later.md`))
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

test('markdown.ts output is private unless its own Response says otherwise, always varies on Accept, and gets its params encoded', async () => {
  const calls = markdownFiles({
    '/shop/[...slug]': ({ params }) => `# ${String(params.slug)}`,
    '/plain': () => ({ markdown: '# Plain' }),
    '/cached': () =>
      new Response('# Cached\n', {
        headers: { 'cache-control': 'public, max-age=60', vary: 'Cookie' },
      }),
    '/bare': () => new Response('# Bare\n'),
  })
  // an x-api-key the handler doesn't know is a credential: still private
  const keyed = await handler(new Request(`${site}/plain.md`, { headers: { 'x-api-key': 'k' } }))
  expect([keyed.headers.get('cache-control'), keyed.headers.get('vary')]).toEqual([
    'private, no-store',
    'Accept',
  ])
  const cached = await handler(new Request(`${site}/cached.md`))
  expect([cached.headers.get('cache-control'), cached.headers.get('vary')]).toEqual([
    'public, max-age=60',
    'Cookie, Accept',
  ])
  const signedIn = await handler(new Request(`${site}/cached.md`, { headers: { cookie: 'sid=1' } }))
  expect(signedIn.headers.get('cache-control')).toBe('private, no-store')
  const bare = await handler(new Request(`${site}/bare.md`))
  expect([bare.headers.get('cache-control'), bare.headers.get('vary')]).toEqual([
    'private, no-store',
    'Accept',
  ])
  // a path-traversal-looking param stays encoded, as the page would get it
  await handler(new Request(`${site}/shop/a%2F..%2F..%2Fadmin%3Fx=1.md`))
  expect(calls.at(-1)).toEqual({
    route: '/shop/[...slug]',
    params: { slug: ['a%2F..%2F..%2Fadmin%3Fx%3D1'] },
  })
})

test('markdown.ts routes match as next matches them: static before dynamic, then catch-alls', async () => {
  const calls = markdownFiles({
    '/': () => '# Home',
    '/x/new': () => '# New',
    '/x/[pkg]': () => '# Pkg',
    '/x/[pkg]/v/[version]': () => '# Version',
    '/docs/[[...slug]]': () => '# Docs',
    '/[...rest]': () => '# Rest',
  })
  for (const path of [
    '/index.md',
    '/x/new.md',
    '/x/%40babel%2Fcore.md',
    '/x/a/v/1.0.0.md',
    '/docs.md',
    '/docs/a/b.md',
    '/x/a/b.md',
  ])
    await handler(new Request(`${site}${path}`))
  expect(calls).toEqual([
    { route: '/', params: {} },
    { route: '/x/new', params: {} },
    // encoded, as next gives the page its params
    { route: '/x/[pkg]', params: { pkg: '%40babel%2Fcore' } },
    { route: '/x/[pkg]/v/[version]', params: { pkg: 'a', version: '1.0.0' } },
    { route: '/docs/[[...slug]]', params: {} },
    { route: '/docs/[[...slug]]', params: { slug: ['a', 'b'] } },
    { route: '/[...rest]', params: { rest: ['x', 'a', 'b'] } },
  ])
  // a page without a markdown.ts renders as before, a static one included, even beside a [param] that has one
  process.env[ROUTES_ENV] = JSON.stringify(['/about', '/x/new', '/x/[pkg]'])
  const pkg = markdownFiles({ '/x/[pkg]': () => '# Pkg' })
  for (const path of ['/about.md', '/x/new.md', '/x/express.md'])
    await handler(new Request(`${site}${path}`))
  expect(seen.map((call) => call.url.pathname)).toEqual(['/about', '/x/new'])
  expect(pkg).toEqual([{ route: '/x/[pkg]', params: { pkg: 'express' } }])
})

test("next's notFound(), forbidden(), unauthorized() and redirect() in a markdown.ts answer as they would for the page", async () => {
  vi.stubEnv('__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS', 'true')
  const navigation = await import('next/navigation.js')
  process.env[ROUTES_ENV] = JSON.stringify(['/x/[pkg]', '/sign-in'])
  const throws: Record<string, () => never> = {
    missing: () => navigation.notFound(),
    hidden: () => navigation.forbidden(),
    locked: () => navigation.unauthorized(),
    login: () => navigation.redirect('/sign-in?next=%2Fx;1'),
    moved: () => navigation.permanentRedirect('/x/new'),
    away: () => navigation.redirect('https://idp.test/authorize'),
    sneaky: () => navigation.redirect('/.//evil.test/x'),
    broken: () => {
      throw new Error('the API is down')
    },
  }
  markdownFiles({ '/x/[pkg]': ({ params }) => throws[String(params.pkg)]!() })
  const ask = (pkg: string, headers: Record<string, string> = {}) =>
    handler(new Request(`${site}/x/${pkg}.md`, { headers }))
  const answers = await Promise.all(
    ['missing', 'hidden', 'locked', 'login', 'moved', 'away'].map(async (pkg) => {
      const response = await ask(pkg)
      return [
        pkg,
        response.status,
        response.headers.get('location'),
        response.headers.get('cache-control'),
        await response.text(),
      ]
    }),
  )
  expect(answers).toEqual([
    ['missing', 404, null, 'private, no-store', '# Not found\n'],
    ['hidden', 403, null, 'private, no-store', '# Forbidden\n'],
    ['locked', 401, null, 'private, no-store', '# Unauthorized\n'],
    // the same redirect rule as the page's own redirects: the target's .md on this site, another origin as it is
    ['login', 307, '/sign-in.md?next=%2Fx;1', 'private, no-store', ''],
    ['moved', 308, '/x/new.md', 'private, no-store', ''],
    ['away', 307, 'https://idp.test/authorize', 'private, no-store', ''],
  ])
  expect(new URL((await ask('sneaky')).headers.get('location')!, site).origin).toBe(site)
  expect((await ask('login')).headers.get('vary')).toBe('Accept')
  expect((await ask('missing', { cookie: 'sid=1' })).headers.get('x-affordances-md-personal')).toBe(
    '1',
  )
  // any other error goes on as it was, for next to answer
  await expect(ask('broken')).rejects.toThrow('the API is down')
  // never a render of the page: markdown.ts answered
  expect(seen).toEqual([])
})

test("on a literalMd route, markdown.ts's 404 for a name is what makes .md the twin suffix", async () => {
  literally({ '/x/readme.md': 200 })
  const calls = markdownFiles({
    '/x/[pkg]': ({ params }) =>
      ['express', 'readme.md'].includes(String(params.pkg))
        ? `# ${params.pkg}`
        : new Response(null, { status: 404 }),
  })
  const markdown = { accept: 'text/markdown' }
  expect(
    await (await handler(new Request(`${site}/x/express.md`, { headers: markdown }))).text(),
  ).toContain('# express')
  expect(
    await (await handler(new Request(`${site}/x/readme.md`, { headers: markdown }))).text(),
  ).toContain('# readme.md')
  expect(calls.map((call) => call.params)).toEqual([
    { pkg: 'express.md' },
    { pkg: 'express' },
    { pkg: 'readme.md' },
  ])
  expect(seen).toHaveLength(0)
})

test('on a literalMd route, markdown.ts returning undefined for a name falls back to the page, whose 404 makes it the twin', async () => {
  literally({ '/x/readme.md': 200 })
  const calls = markdownFiles({
    '/x/[pkg]': ({ params }) => (params.pkg === 'express' ? '# express' : undefined),
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const response = await handler(
    new Request(`${site}/x/express.md`, { headers: { accept: 'text/markdown' } }),
  )
  warn.mockRestore()
  expect(await response.text()).toContain('# express')
  expect(calls.map((call) => call.params)).toEqual([{ pkg: 'express.md' }, { pkg: 'express' }])
  // the page's own html, asked for express.md, 404s
  expect(seen.map((call) => call.url.pathname)).toEqual(['/x/express.md'])
})

test("llms-full and llms.txt render each page as an anonymous visitor, so markdown.ts never sees the caller's cookies", async () => {
  process.env[ROUTES_ENV] = JSON.stringify(['/about', '/me'])
  // like cookies() from next/headers: the cookie of the request it runs in
  const cookie = () => requestContext.getStore()?.get('cookie')
  markdownFiles({
    '/about': () => ({ markdown: '# About us\n\nWe make tees.', title: 'About us' }),
    '/me': () => `# Me\n\n${cookie() ? `Signed in as ${cookie()}.` : 'Not signed in.'}`,
  })
  upstream = () => new Response('', { status: 404 })
  const caller = new Headers({ cookie: 'sid=ALICE-SECRET' })
  const full = await requestContext.run(caller, () =>
    createLlmsFullHandler()(new Request(`${site}/llms-full.txt`, { headers: caller })),
  )
  const text = await full.text()
  expect(text).toContain(`# About us (${site}/about)\n\nWe make tees.`)
  expect(text).toContain('Not signed in.')
  expect(text).not.toContain('ALICE-SECRET')
  // a caller with credentials gets the public file, never cached as everyone's: a markdown() of the app's own could
  // have read them through cookies()
  expect(full.headers.get('cache-control')).toBe('private, no-store')
  // each page's twin, the url its markdown is cached at, which the rewrites and proxy.ts see like any visitor's request
  expect(routed.map((call) => call.url.pathname)).toEqual(['/about.md', '/me.md'])
  expect(routed.every((call) => call.headers.get('accept') === 'text/markdown')).toBe(true)
  for (const call of routed) {
    expect(call.headers.has('cookie')).toBe(false)
    expect(call.headers.has(RENDER_HEADER)).toBe(false)
  }

  routed = []
  const index = await requestContext.run(caller, () =>
    createLlmsTxtHandler({ title: 'Shop' })(new Request(`${site}/llms.txt`, { headers: caller })),
  )
  expect(await index.text()).toContain(`- [About us](${site}/about.md)`)
  expect(index.headers.get('cache-control')).toBe('private, no-store')
  expect(routed.every((call) => !call.headers.has('cookie'))).toBe(true)
})

// a markdown request's body, at any url
const markdownAt = async (url: string, headers: Record<string, string> = {}) =>
  (await handler(new Request(url, { headers }))).text()

test("a markdown.ts Response's own caching holds only at the .md url; at the page url it's private", async () => {
  markdownFiles({
    '/cached': () =>
      new Response('# Cached\n', { headers: { 'cache-control': 'public, s-maxage=3600' } }),
  })
  const atPage = await handler(
    new Request(`${site}/cached`, { headers: { accept: 'text/markdown' } }),
  )
  expect(atPage.headers.get('cache-control')).toBe('private, no-store')
  expect((await handler(new Request(`${site}/cached.md`))).headers.get('cache-control')).toBe(
    'public, s-maxage=3600',
  )
})

test('markdown.ts never runs for a path under _next or api, even reached straight', async () => {
  process.env[ROUTES_ENV] = JSON.stringify(['/[...slug]'])
  const calls = markdownFiles({ '/[...slug]': () => '# Caught' })
  for (const path of ['/_next/static/x.md', '/api/x.md'])
    await handler(new Request(`${site}${path}`))
  expect(calls).toEqual([])
  await handler(new Request(`${site}/guide.md`))
  expect(calls).toHaveLength(1)
})

test('llms leaves out a page its markdown route rendered privately, so the files stay the public view', async () => {
  process.env[ROUTES_ENV] = JSON.stringify(['/about', '/me'])
  markdownFiles({
    '/about': () =>
      new Response('---\ntitle: "About"\n---\n\n# About\n\nPublic.\n', {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'cache-control': 'public, max-age=60',
        },
      }),
    // its author marks it private
    '/me': () =>
      new Response('---\ntitle: "Service view"\n---\n\n# Me\n\nSERVICE-ONLY\n', {
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'private' },
      }),
  })
  upstream = () => new Response('', { status: 404 })
  const full = await createLlmsFullHandler()(new Request(`${site}/llms-full.txt`))
  const text = await full.text()
  expect(text).toContain('Public.')
  expect(text).not.toContain('SERVICE-ONLY')
  expect(full.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600')
  const index = await (
    await createLlmsTxtHandler({ title: 'Shop' })(new Request(`${site}/llms.txt`))
  ).text()
  expect(index).toContain(`- [About](${site}/about.md)`)
  // still listed, by its path: no title taken from a private render
  expect(index).toContain(`- [/me](${site}/me.md)`)
  expect(index).not.toContain('Service view')

  // a converted page the route rendered with its own service credentials is marked personal, so llms leaves it out
  upstream = () =>
    new Response(page('<h1>Account</h1>'), { headers: { 'content-type': 'text/html' } })
  const service = await createMdHandler({ headers: { cookie: 'sid=SERVICE' } })(
    new Request(`${site}/account`, { headers: { accept: 'text/markdown' } }),
  )
  expect(service.headers.get('x-affordances-md-personal')).toBe('1')
  // nor a dynamic page next marks private, no-store, rendered with no credentials at all: it's the public view
  upstream = () =>
    new Response(page('<h1>Dynamic</h1>', '<title>Dynamic</title>'), {
      headers: {
        'content-type': 'text/html',
        'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate',
      },
    })
  const dynamic = await handler(
    new Request(`${site}/dyn`, { headers: { accept: 'text/markdown' } }),
  )
  expect([
    dynamic.headers.get('cache-control'),
    dynamic.headers.has('x-affordances-md-personal'),
  ]).toEqual(['private, no-store', false])
  process.env[ROUTES_ENV] = JSON.stringify(['/dyn'])
  markdownFiles({})
  const dynamicFull = await (
    await createLlmsFullHandler()(new Request(`${site}/llms-full.txt`))
  ).text()
  expect(dynamicFull).toContain(`# Dynamic (${site}/dyn)`)
  upstream = () =>
    new Response(page('<h1>Account</h1>'), { headers: { 'content-type': 'text/html' } })
  // merely negotiated (private only for where it was served) isn't
  const negotiated = await handler(
    new Request(`${site}/account`, { headers: { accept: 'text/markdown' } }),
  )
  expect([
    negotiated.headers.get('cache-control'),
    negotiated.headers.has('x-affordances-md-personal'),
  ]).toEqual(['private, no-store', false])
})

test("markdown.ts answers only at the page's own url, the one proxy.ts gated, matched as strictly as next routes", async () => {
  process.env[ROUTES_ENV] = JSON.stringify(['/dashboard/[id]', '/docs/[...slug]'])
  const calls = markdownFiles({
    '/dashboard/[id]': ({ params }) => `# Dashboard ${params.id}\n\nSECRET`,
    '/docs/[...slug]': () => '# Docs\n\nSECRET',
  })

  // at the page's url: /x.md, /x asked for with Accept, a percent-encoded param
  expect(await markdownAt(`${site}/dashboard/123.md`)).toContain('SECRET')
  expect(await markdownAt(`${site}/dashboard/123`, { accept: 'text/markdown' })).toContain('SECRET')
  expect(await markdownAt(`${site}/dashboard/%31%32%33.md`)).toContain('# Dashboard 123')
  expect(calls).toHaveLength(3)
  expect(seen).toHaveLength(0)

  // straight to the handler's url, which a page-scoped proxy matcher never saw: the html render, at the page's url
  for (const url of [
    `${site}/api/affordances/md/dashboard/123`,
    `${site}/api/affordances/md/dashboard/123.md`,
    `${site}/API/affordances/md/dashboard/123`,
  ]) {
    seen = []
    expect(await markdownAt(url)).not.toContain('SECRET')
    expect(seen.map((call) => call.url.pathname)).toEqual(['/dashboard/123'])
  }
  // urls the rewrites match but next's routing (and a proxy matcher) wouldn't call that page: never markdown.ts
  for (const path of [
    '/Dashboard/123.md',
    '/DASHBOARD/123.md',
    '/%64ashboard/123.md',
    '/dashboard//123.md',
    '/dashboard/123/.md',
    '/docs//a.md',
    '/docs/a//b.md',
    // next's own routing isn't strict about a trailing /, but it 308s /x/ to /x before any rewrite or proxy, so a
    // trailing / only reaches here hand-made; strict is the safe side
    '/dashboard/123/',
  ]) {
    seen = []
    expect({ path, body: await markdownAt(`${site}${path}`) }).not.toEqual({
      path,
      body: expect.stringContaining('SECRET'),
    })
    expect(seen).toHaveLength(1)
  }
  expect(calls).toHaveLength(3)
})

test("llms asks for each page's twin, and on a literal route the page's own url with Accept, so x and x.md are each themselves; it skips one the proxy redirects", async () => {
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/x/:pkg']))
  markdownFiles({ '/': () => '# Home' })
  process.env[ROUTES_ENV] = JSON.stringify(['/', '/x/[pkg]'])
  // the package readme, and a package actually named readme.md
  upstream = (url) =>
    ['/x/readme', '/x/readme.md'].includes(url.pathname)
      ? new Response(page(`<h1>${url.pathname}</h1>`), { headers: { 'content-type': 'text/html' } })
      : new Response('', { status: 404 })
  const appFetch = globalThis.fetch
  // a proxy.ts gate, turning the anonymous request for /private away
  vi.stubGlobal('fetch', (url: URL, init: RequestInit) =>
    new URL(url).pathname === '/private.md'
      ? Promise.resolve(new Response(null, { status: 307, headers: { location: '/login.md' } }))
      : appFetch(url, init),
  )
  const text = await (
    await createLlmsFullHandler({ pages: () => ['/', '/x/readme', '/x/readme.md', '/private'] })(
      new Request(`${site}/llms-full.txt`),
    )
  ).text()
  expect(routed.map((call) => call.url.pathname)).toEqual([
    '/index.md',
    '/x/readme',
    '/x/readme.md',
  ])
  expect(text).toBe(
    `# Home (${site}/)\n\n# /x/readme (${site}/x/readme)\n\n# /x/readme.md (${site}/x/readme.md)\n`,
  )
})

test("llms never fetches a path that leaves the site's origin, nor sends it the headers option", async () => {
  const bearer = { authorization: 'Bearer svc' }
  const offsite = ['//evil.example/x', 'https://other.test/y', '/\\evil.example/z']
  upstream = (url) =>
    url.pathname === '/.well-known/affordances.json'
      ? Response.json({ routes: [{ route: '//evil.example/index' }, { route: '/about' }] })
      : new Response('', { status: 404 })
  await createLlmsFullHandler({ headers: bearer, pages: (_, routes) => [...routes, ...offsite] })(
    new Request(`${site}/llms-full.txt`),
  )
  await createLlmsTxtHandler({
    headers: bearer,
    sections: () => [{ title: 'Pages', pages: offsite }],
  })(new Request(`${site}/llms.txt`))
  const origins = [...seen, ...routed].map((call) => new URL(call.url).origin)
  expect(new Set(origins)).toEqual(new Set([site]))
  expect(routed.map((call) => call.url.pathname)).toEqual(['/about.md'])
})

test('the llms handlers take only the options they use for their own requests', () => {
  expect(createLlmsFullHandler({ origin: site, headers: { a: 'b' }, timeout: 1 })).toBeTypeOf(
    'function',
  )
  expect(createLlmsTxtHandler({ origin: site, headers: () => ({}), timeout: 1 })).toBeTypeOf(
    'function',
  )
  // each page renders as its markdown route answers it, so these belong on createMdHandler there
  // @ts-expect-error maxBytes is the route's
  createLlmsFullHandler({ maxBytes: 1 })
  // @ts-expect-error append is the route's
  createLlmsTxtHandler({ append: () => '' })
})

test('@affordances/md/next/proxy is the same proxy side as @affordances/md/next, and reaches no converter or markdown.ts', async () => {
  const next = await import('../src/next/index.ts')
  const proxy = await import('../src/next/proxy.ts')
  expect(Object.keys(proxy).toSorted()).toEqual([
    'MD_PATH',
    'RENDER_HEADER',
    'isMdRequest',
    'mdLink',
    'mdPagePath',
    'mdPath',
    'mdProxy',
    'mdRewrite',
    'rewrites',
  ])
  for (const [name, value] of Object.entries(proxy))
    expect({ name, same: next[name as keyof typeof next] === value }).toEqual({ name, same: true })

  // everything proxy.ts imports, all the way down
  const visited = new Set<string>()
  const packages: string[] = []
  const walk = (file: URL) => {
    if (visited.has(file.href)) return
    visited.add(file.href)
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(
      /^\s*(?:import|export)\b[^'"]*?(?:from\s+)?'([^']+)'/gm,
    ))
      if (spec!.startsWith('.')) walk(new URL(spec!, file))
      else packages.push(spec!)
  }
  walk(new URL('../src/next/proxy.ts', import.meta.url))
  const files = [...visited].map((href) => href.replace(/^.*\/src\//, ''))
  expect(files.toSorted()).toEqual(['next/proxy.ts', 'next/routes.ts', 'next/rules.ts', 'path.ts'])
  expect(packages.filter((spec) => /^@affordances\/md\/routes$|hast-|mdast-/.test(spec))).toEqual(
    [],
  )
})

// next.config.mjs loads @affordances/md/next in plain node, not a bundler: an import node's esm can't resolve (next
// has no exports map, so 'next/server' needs its .js) breaks every app's config, which a vite-run test never sees
test('the next entries load in plain node, as next.config does', () => {
  for (const entry of ['../src/next/index.ts', '../src/next/proxy.ts']) {
    const url = new URL(entry, import.meta.url).href
    const loaded = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-warnings',
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(url)}); process.stdout.write(typeof m.mdProxy)`,
      ],
      { encoding: 'utf8' },
    )
    expect({ entry, loaded }).toEqual({ entry, loaded: 'function' })
  }
})

test('md() records each markdown.ts next to a page, generates .affordances/md.ts and aliases it', async () => {
  const project = app([
    'app/page.tsx',
    'app/markdown.ts',
    'app/(shop)/products/[slug]/page.tsx',
    'app/(shop)/products/[slug]/markdown.tsx',
    'app/registry/[registry]/npm/package/[pkg]/page.tsx',
    'app/registry/[registry]/npm/package/[pkg]/markdown.ts',
    'app/orphan/markdown.ts',
  ])
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(scanApp(project).markdown).toEqual([
    { route: '/', file: 'app/markdown' },
    { route: '/products/[slug]', file: 'app/(shop)/products/[slug]/markdown' },
    {
      route: '/registry/[registry]/npm/package/[pkg]',
      file: 'app/registry/[registry]/npm/package/[pkg]/markdown',
    },
  ])
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('app/orphan/markdown.ts has no page.tsx'),
  )
  warn.mockRestore()

  const config = md({ root: project })({
    turbopack: { resolveAlias: { '@affordances/next/manifest': './.affordances/manifest.ts' } },
    webpack: (webpack: { marked?: boolean }) => ({ ...webpack, marked: true }),
  } as Config)
  const generated = join(project, '.affordances', 'md.ts')
  expect(readFileSync(generated, 'utf8'))
    .toBe(`// generated by @affordances/md from app/**/markdown.ts; don't edit
import type { CacheLifeProfile, MarkdownModule, MarkdownRoutes, PublicCache } from '@affordances/md/next'

// the cacheLife profiles a publicCache can name: next's own and next.config's
type Profile = CacheLifeProfile

// each markdown.ts is checked against its own route. a type error on a line here means that file's default export or
// slots name another route (MarkdownArgs<'/…'>, Slots<'/…'>) or return something else: fix it in that file
export const routes = {
  "/": (): Promise<MarkdownModule<"/", PublicCache<Profile>>> =>
    import("../app/markdown"),
  "/products/[slug]": (): Promise<MarkdownModule<"/products/[slug]", PublicCache<Profile>>> =>
    import("../app/(shop)/products/[slug]/markdown"),
  "/registry/[registry]/npm/package/[pkg]": (): Promise<MarkdownModule<"/registry/[registry]/npm/package/[pkg]", PublicCache<Profile>>> =>
    import("../app/registry/[registry]/npm/package/[pkg]/markdown"),
} satisfies MarkdownRoutes
`)
  // both aliases: withAffordances' manifest and ours, sharing .affordances/
  expect(config.turbopack!.resolveAlias).toEqual({
    '@affordances/next/manifest': './.affordances/manifest.ts',
    // relative to md()'s root, the project, whatever directory next runs from
    '@affordances/md/routes': './.affordances/md.ts',
  })
  const webpack = config.webpack!({ resolve: { alias: {} } }, {})
  expect(webpack).toEqual({
    resolve: { alias: { '@affordances/md/routes': generated } },
    marked: true,
  })

  // written only when it changed, so watchers don't loop
  const written = statSync(generated).mtimeMs
  writeMarkdownRoutes(project, scanApp(project).markdown)
  expect(statSync(generated).mtimeMs).toBe(written)

  // no markdown.ts: no file and no alias
  const plain = md({ root: app(['app/page.tsx']) })({} as Config)
  expect(plain.turbopack).toBeUndefined()
  expect(existsSync(join(root, '.affordances'))).toBe(false)
})

test('the uppercase .MD next rewrites still finds the page', async () => {
  await handler(new Request(`${site}/pricing.MD`))
  expect(seen[0]!.url.pathname).toBe('/pricing')
})

test("the headers option's cookie and authorization apply only to a request that sent neither", async () => {
  upstream = () =>
    new Response(page('<h1>Account</h1>'), {
      headers: [
        ['content-type', 'text/html'],
        ['set-cookie', 'session=svc-refreshed'],
      ],
    })
  const service = createMdHandler({
    headers: { cookie: 'session=svc', authorization: 'Bearer svc', 'x-bypass': 'b' },
  })
  const sent = async (headers: Record<string, string>) => {
    seen = []
    const response = await service(new Request(`${site}/account.md`, { headers }))
    return { headers: seen[0]!.headers, response }
  }
  // signed in with a cookie: hers alone, and no service bearer either, which an app checking a bearer first would
  // render her as
  const person = await sent({ cookie: 'session=alice' })
  expect([person.headers.get('cookie'), person.headers.get('authorization')]).toEqual([
    'session=alice',
    null,
  ])
  expect(person.headers.get('x-bypass')).toBe('b')
  // anonymous: the service's credentials render it
  const anonymous = await sent({})
  expect([anonymous.headers.get('cookie'), anonymous.headers.get('authorization')]).toEqual([
    'session=svc',
    'Bearer svc',
  ])
  const bearer = await sent({ authorization: 'Bearer alice' })
  expect([bearer.headers.get('cookie'), bearer.headers.get('authorization')]).toEqual([
    null,
    'Bearer alice',
  ])
  // every one of them is private, and markdown never carries a cookie set for anyone
  for (const { response } of [person, anonymous, bearer]) {
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.getSetCookie()).toEqual([])
  }
})

test('headers adds to the page fetch, after the forwarded ones, but never replaces our own', async () => {
  await createMdHandler({ headers: { 'x-vercel-protection-bypass': 's3cret', accept: 'x' } })(
    new Request(`${site}/api/affordances/md/a`, { headers: { cookie: 'sid=1' } }),
  )
  await createMdHandler({ headers: (request) => ({ 'x-from': new URL(request.url).pathname }) })(
    new Request(`${site}/api/affordances/md/b`),
  )
  expect(seen[0]!.headers.get('x-vercel-protection-bypass')).toBe('s3cret')
  expect(seen[0]!.headers.get('cookie')).toBe('sid=1')
  expect(seen[0]!.headers.get('accept')).toBe('text/html')
  expect(seen[0]!.headers.get(RENDER_HEADER)).toBe('1')
  expect(seen[1]!.headers.get('x-from')).toBe('/api/affordances/md/b')
  // credentials added here are credentials too: the markdown stays private
  const response = await createMdHandler({ headers: { authorization: 'Bearer x' } })(
    new Request(`${site}/api/affordances/md/a`),
  )
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})

test('the llms handlers resolve headers once, send them everywhere, and stay private with credentials', async () => {
  upstream = affordancesSite
  const headers = vi.fn(() => ({ 'x-vercel-protection-bypass': 's3cret' }))
  const response = await createLlmsTxtHandler({ headers })(new Request(`${site}/llms.txt`))
  expect(headers).toHaveBeenCalledTimes(1)
  // the site index, and each page's markdown route; the route's own fetch of the page takes the route's options
  const own = [...seen.filter((call) => call.url.pathname.startsWith('/.well-known')), ...routed]
  expect(routed.length).toBeGreaterThan(1)
  expect(own.every((call) => call.headers.get('x-vercel-protection-bypass') === 's3cret')).toBe(
    true,
  )
  expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600')
  const signedIn = await createLlmsFullHandler({ headers: { authorization: 'Bearer svc' } })(
    new Request(`${site}/llms-full.txt`),
  )
  expect(signedIn.headers.get('cache-control')).toBe('private, no-store')
})

// an app/ dir: groups, a dynamic segment, an optional catch-all, and folders that aren't urls
let root: string
const app = (files: string[]) => {
  root = mkdtempSync(join(tmpdir(), 'md-app-'))
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), '')
  }
  return root
}
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  delete process.env[ROUTES_ENV]
})
const shop = [
  'src/app/page.tsx',
  'src/app/(shop)/cart/page.tsx',
  'src/app/products/[slug]/page.tsx',
  'src/app/team/[member-id]/page.tsx',
  'src/app/docs/[[...slug]]/page.mdx',
  'src/app/_private/page.tsx',
  'src/app/@modal/(.)products/[slug]/page.tsx',
  'src/app/api/x/route.ts',
  'src/app/robots.ts',
]

test('md() finds the pages in app/ and hands them to the handlers', () => {
  const config = md({ root: app(shop) })({} as Config)
  expect(JSON.parse(config.env![ROUTES_ENV]!)).toEqual([
    '/',
    '/cart',
    '/docs/[[...slug]]',
    '/products/[slug]',
    '/team/[member-id]',
  ])
  // without an app/ there are no pages, and it says so rather than leaving Link and llms.txt quietly empty
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(md({ root: app([]) })({} as Config).env![ROUTES_ENV]).toBe('[]')
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('no app/ directory'))
  warn.mockRestore()
})

test('llms defaults to the pages md() found when the site has no Affordances index', async () => {
  process.env[ROUTES_ENV] = JSON.stringify(['/', '/cart', '/products/[slug]'])
  upstream = (url) =>
    url.pathname.startsWith('/.well-known')
      ? new Response('', { status: 404 })
      : new Response(page('<p>x</p>', `<title>${url.pathname}</title>`), {
          headers: { 'content-type': 'text/html' },
        })
  const body = await (await createLlmsTxtHandler()(new Request(`${site}/llms.txt`))).text()
  expect(body).toContain(`- [/](${site}/index.md)`)
  expect(body).toContain(`- [/cart](${site}/cart.md)`)
  expect(body).not.toContain('slug')
})

test("llms keeps the site index's order, then adds the pages only md() found", async () => {
  process.env[ROUTES_ENV] = JSON.stringify(['/about', '/concepts'])
  upstream = (url) =>
    url.pathname === '/.well-known/affordances.json'
      ? Response.json({
          routes: [{ route: '/' }, { route: '/quickstart' }, { route: '/concepts' }],
        })
      : new Response(page(`<h1>${url.pathname}</h1>`), { headers: { 'content-type': 'text/html' } })
  await createLlmsFullHandler()(new Request(`${site}/llms-full.txt`))
  expect(seen.map((call) => call.url.pathname)).toEqual([
    '/.well-known/affordances.json',
    '/',
    '/quickstart',
    '/concepts',
    '/about',
  ])
})

const linkOn = (rules: Header[], pathname: string) => {
  // next applies every matching rule in order; the last value set for a key wins
  let value: string | undefined
  for (const rule of rules) {
    const params = getPathMatch(rule.source)(pathname)
    const link = params && rule.headers.find((h) => h.key.toLowerCase() === 'link')
    if (link) value = compileNonPath(link.value, params)
  }
  return value
}
const alternate = (path: string) => `<${path}>; rel="alternate"; type="text/markdown"`

test('md() points every page at its markdown twin with a Link header', async () => {
  const rules = await md({ root: app(shop) })({} as Config).headers!()
  expect(linkOn(rules, '/')).toBe(alternate('/index.md'))
  expect(linkOn(rules, '/cart')).toBe(alternate('/cart.md'))
  expect(linkOn(rules, '/products/tee')).toBe(alternate('/products/tee.md'))
  expect(linkOn(rules, '/docs')).toBe(alternate('/docs.md'))
  expect(linkOn(rules, '/docs/a/b')).toBe(alternate('/docs/a/b.md'))
  expect(linkOn(rules, '/team/ada')).toBe(alternate('/team/ada.md'))
  // a page's own twin isn't pointed at a .md.md
  expect(linkOn(rules, '/products/tee.md')).toBeUndefined()
  expect(linkOn(rules, '/docs/a/b.md')).toBeUndefined()
  expect(linkOn(rules, '/api/x')).toBeUndefined()
  expect(linkOn(rules, '/robots.txt')).toBeUndefined()
  expect(await md({ root, link: false })({} as Config).headers!()).toEqual([])
})

test('md({ literalMd }) hands the routes to the handlers and rewrites their .md pages asked for with Accept', async () => {
  const config = md({ root: app(['app/x/[pkg]/page.tsx']), literalMd: ['/x/:pkg'] })({} as Config)
  expect(JSON.parse(config.env![LITERAL_ENV]!)).toEqual(['/x/:pkg'])
  const { beforeFiles } = (await config.rewrites!()) as Rewrites
  expect(beforeFiles.at(-1)).toEqual({
    source: '/x/:pkg',
    has: [{ type: 'header', key: 'accept', value: '.*text/markdown.*' }],
    missing: [
      { type: 'header', key: RENDER_HEADER },
      { type: 'header', key: 'rsc' },
      { type: 'query', key: '_rsc' },
    ],
    destination: '/api/affordances/md',
  })
  // config rules can't tell the page readme.md from a twin, so .md urls get no Link there; the handler adds it
  const rules = await config.headers!()
  expect(linkOn(rules, '/x/express')).toBe(alternate('/x/express.md'))
  expect(linkOn(rules, '/x/readme.md')).toBeUndefined()
  expect(md({ root })({} as Config).env![LITERAL_ENV]).toBeUndefined()
})

test("md() adds its Link to Affordances' own, which a separate rule would replace", async () => {
  const graph = '<?affordances=1>; rel="affordances"'
  const user: Header[] = [
    { source: '/', headers: [{ key: 'Link', value: graph }] },
    { source: '/cart', headers: [{ key: 'Link', value: graph }] },
    { source: '/docs/:slug*', headers: [{ key: 'Link', value: graph }] },
    { source: '/:path*', headers: [{ key: 'x-other', value: '1' }] },
    { source: '/', headers: [{ key: 'Link', value: '</font.woff2>; rel=preload' }] },
  ]
  const rules = await md({ root: app(shop) })({ headers: async () => user } as Config).headers!()
  expect(linkOn(rules, '/cart')).toBe(`${graph}, ${alternate('/cart.md')}`)
  // two rules set Link on /: the last one wins in next, so it has to carry the twin too
  expect(linkOn(rules, '/')).toBe(`</font.woff2>; rel=preload, ${alternate('/index.md')}`)
  // an optional catch-all's rule is split like ours, so both urls keep the graph's Link and get the twin
  expect(linkOn(rules, '/docs')).toBe(`${graph}, ${alternate('/docs.md')}`)
  expect(linkOn(rules, '/docs/a/b')).toBe(`${graph}, ${alternate('/docs/a/b.md')}`)
  expect(rules).toContainEqual(user[3])
  // the app's own rules aren't changed in place
  expect(user[0]!.headers[0]!.value).toBe(graph)
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
  const graph = { source: '/', destination: '/api/affordances/graph' }
  const nested = (await withMd({ rewrites: async () => ({ beforeFiles: [graph] }) })
    .rewrites!()) as { beforeFiles: unknown[] }
  expect(nested.beforeFiles).toEqual([graph, ...rewrites.beforeFiles])
})

test('mdAlternate', () => {
  expect(mdAlternate('/')).toEqual({ types: { 'text/markdown': '/index.md' } })
  expect(mdAlternate('/blog/post/')).toEqual({ types: { 'text/markdown': '/blog/post.md' } })
})

test('llms-full joins every page as public markdown, headed with its url, skipping failures', async () => {
  upstream = (url) =>
    url.pathname === '/gone'
      ? new Response('', { status: 404, headers: { 'content-type': 'text/html' } })
      : new Response(page(`<h1>Page ${url.pathname}</h1><p>Body.</p>`), {
          headers: { 'content-type': 'text/html' },
        })
  const full = createLlmsFullHandler({ pages: () => ['/', '/a', '/gone'] })
  const response = await full(
    new Request(`${site}/llms-full.txt`, { headers: { cookie: 'sid=1' } }),
  )
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  expect(await response.text()).toBe(
    `# Page / (${site}/)\n\nBody.\n\n# Page /a (${site}/a)\n\nBody.\n`,
  )
  // the site index is read too, for its routes; then each page in order
  expect(seen.map((call) => call.url.pathname)).toEqual([
    '/.well-known/affordances.json',
    '/',
    '/a',
    '/gone',
  ])
  // the public site: the caller's cookies are not forwarded
  expect(seen.every((call) => !call.headers.has('cookie'))).toBe(true)
})

// an Affordances site: its index, and pages with titles in the 'Page · Site' form
const affordancesSite = (url: URL) =>
  url.pathname === '/.well-known/affordances.json'
    ? Response.json({
        name: 'Acme Store',
        routes: [
          { route: '/', description: 'Every product, with its price' },
          { route: '/cart', description: 'What is in the cart' },
          { route: '/products/[slug]' },
        ],
      })
    : new Response(
        page(
          `<h1>${url.pathname}</h1><p>Body.</p>`,
          `<title>${url.pathname === '/' ? 'Home' : 'Cart'} · Acme Store</title><meta name="description" content="The page's own words">`,
        ),
        { headers: { 'content-type': 'text/html' } },
      )

// the env name md() sets when there's no Affordances graph: md's own, never public api
const SITE_INDEX_ENV = 'AFFORDANCES_MD_SITE_INDEX'

test('without the Affordances graph, the llms handlers never ask for a site index', async () => {
  const project = app(['app/page.tsx', 'app/a/page.tsx'])
  const plain: Config = md({ root: project })({})
  expect(plain.env?.[SITE_INDEX_ENV]).toBe('none')
  // withAffordances points its route at the app's manifest before its plugins run
  const afforded: Config = md({ root: project })({
    turbopack: { resolveAlias: { '@affordances/next/manifest': './.affordances/manifest.ts' } },
  })
  expect(afforded.env).not.toHaveProperty(SITE_INDEX_ENV)
  upstream = affordancesSite
  for (const name of [ROUTES_ENV, SITE_INDEX_ENV]) vi.stubEnv(name, plain.env![name]!)
  await createLlmsFullHandler()(new Request(`${site}/llms-full.txt`))
  expect(seen.map((call) => call.url.pathname)).toEqual(['/', '/a'])
  vi.unstubAllEnvs()
})

test('llms-full defaults to the site index routes that need no params', async () => {
  upstream = affordancesSite
  const response = await createLlmsFullHandler()(new Request(`${site}/llms-full.txt`))
  const body = await response.text()
  expect(body).toContain(`(${site}/)`)
  expect(body).toContain(`(${site}/cart)`)
  expect(body).not.toContain('[slug]')
})

test('llms.txt lists each page twin with its title and the route description, and says how to act', async () => {
  upstream = affordancesSite
  const llms = createLlmsTxtHandler({ summary: 'A demo store.' })
  const body = await (await llms(new Request(`${site}/llms.txt`))).text()
  expect(body).toBe(
    [
      '# Acme Store',
      '> A demo store.',
      `Every page is also Markdown: add \`.md\` to its URL, or request it with \`Accept: text/markdown\`. For the full text in one file, see [llms-full.txt](${site}/llms-full.txt).`,
      `This site is Affordances-enabled: request any page with \`Accept: application/vnd.affordances+json\` for its graph (what the page shows, and the actions you can call there, with their inputs). [/.well-known/affordances.json](${site}/.well-known/affordances.json) lists every route and its actions.`,
      `## Pages\n\n- [Home](${site}/index.md): Every product, with its price\n- [Cart](${site}/cart.md): What is in the cart`,
    ].join('\n\n') + '\n',
  )
})

test("llms.txt's note replaces the plugin's sentences, or false drops them, and comes before the intro", async () => {
  upstream = affordancesSite
  vi.stubEnv(ROUTES_ENV, JSON.stringify(['/', '/cart']))
  const head = async (options: Parameters<typeof createLlmsTxtHandler>[0]) =>
    (
      await (
        await createLlmsTxtHandler({
          summary: 'A demo store.',
          intro: 'Start at [the cart](/cart).',
          sections: () => [],
          ...options,
        })(new Request(`${site}/llms.txt`))
      ).text()
    )
      .trim()
      .split('\n\n')
  // by default: title, summary, the plugin's sentences, then the site's intro
  const plain = await head({})
  expect(plain[0]).toBe('# Acme Store')
  expect(plain[1]).toBe('> A demo store.')
  expect(plain[2]).toMatch(/^Every page is also Markdown/)
  expect(plain[3]).toMatch(/^This site is Affordances-enabled/)
  expect(plain[4]).toBe(`Start at [the cart](${site}/cart.md).`)
  // a note of the site's own, its links resolved and twinned like the intro's
  expect(await head({ note: 'Add `.md` to any [page](/cart) for its Markdown.' })).toEqual([
    '# Acme Store',
    '> A demo store.',
    `Add \`.md\` to any [page](${site}/cart.md) for its Markdown.`,
    `Start at [the cart](${site}/cart.md).`,
  ])
  expect(await head({ note: false })).toEqual([
    '# Acme Store',
    '> A demo store.',
    `Start at [the cart](${site}/cart.md).`,
  ])
  vi.unstubAllEnvs()
})

test("llms.txt sections nest down to ######, a section's own intro and links first, and an empty one at any depth left out", async () => {
  upstream = (url) =>
    new Response(page(`<h1>${url.pathname}</h1>`, `<title>${url.pathname}</title>`), {
      headers: { 'content-type': 'text/html' },
    })
  const deep = (depth: number): LlmsSection =>
    depth
      ? { title: `Level ${depth}`, pages: [`/l${depth}`], sections: [deep(depth - 1)] }
      : { title: 'Empty' }
  const body = await (
    await createLlmsTxtHandler({
      title: 'Docs',
      full: false,
      note: false,
      sections: () => [
        {
          title: 'Guides',
          intro: 'How to.',
          pages: ['/guides'],
          sections: [
            { title: 'Install', pages: ['/install'] },
            { title: 'Nothing', sections: [{ title: 'Still nothing' }] },
            {
              title: 'Configure',
              pages: ['/config'],
              sections: [{ title: 'Registries', pages: ['/config/registries'] }],
            },
          ],
        },
      ],
    })(new Request(`${site}/llms.txt`))
  ).text()
  expect(body).toBe(
    [
      '# Docs',
      '## Guides',
      'How to.',
      `- [/guides](${site}/guides.md)`,
      '### Install',
      `- [/install](${site}/install.md)`,
      '### Configure',
      `- [/config](${site}/config.md)`,
      '#### Registries',
      `- [/config/registries](${site}/config/registries.md)\n`,
    ].join('\n\n'),
  )
  // five levels under ## is ######; one more is a mistake, said with the section's name
  const ok = await createLlmsTxtHandler({ note: false, sections: () => [deep(5)] })(
    new Request(`${site}/llms.txt`),
  )
  expect(await ok.text()).toContain('###### Level 1')
  await expect(
    createLlmsTxtHandler({ note: false, sections: () => [deep(6)] })(
      new Request(`${site}/llms.txt`),
    ),
  ).rejects.toThrow(
    `[affordances-md] llms.txt's section "Level 1" is nested deeper than ######, Markdown's last heading level`,
  )
})

test('llms.txt takes your sections, mixing rendered paths and given links, without an Affordances index', async () => {
  upstream = (url) =>
    url.pathname.startsWith('/.well-known')
      ? new Response('', { status: 404 })
      : new Response(
          page('<p>x</p>', '<title>Post</title><meta name="description" content="About">'),
          {
            headers: { 'content-type': 'text/html' },
          },
        )
  const llms = createLlmsTxtHandler({
    title: 'Blog',
    full: false,
    sections: (_, routes) => [
      { title: 'Posts', pages: ['/post'] },
      { title: 'Elsewhere', pages: [{ url: '/about', title: 'About us', description: 'Who' }] },
      { title: 'Empty', pages: routes },
    ],
  })
  const body = await (await llms(new Request(`${site}/llms.txt`))).text()
  expect(body).toContain('# Blog')
  expect(body).toContain(`- [Post](${site}/post.md): About`)
  expect(body).toContain(`- [About us](${site}/about.md): Who`)
  expect(body).not.toContain('llms-full')
  expect(body).not.toContain('Affordances-enabled')
  expect(body).not.toContain('## Empty')
})

test("the markdown links the site's own pages to their twins, keeping search and hash", async () => {
  process.env[ROUTES_ENV] = JSON.stringify(['/', '/blog/[slug]', '/docs/[[...slug]]', '/about'])
  upstream = () =>
    new Response(
      page(`<h1>Links</h1><p>
        <a href="/">Home</a> <a href="/blog/post?ref=1#comments">Post</a> <a href="/about/">About</a>
        <a href="/docs">Docs</a> <a href="/docs/a/b">Deep</a> <a href="#links">Here</a>
        <a href="/blog/post.md">Twin</a> <a href="/api/cart">API</a> <a href="/logo.png">Logo</a>
        <a href="/blog/a/b">Not a post</a> <a href="https://other.test/about">Elsewhere</a></p>`),
      { headers: { 'content-type': 'text/html' } },
    )
  const linked = await (await get('/page')).text()
  for (const link of [
    '[Home](https://shop.test/index.md)',
    '[Post](https://shop.test/blog/post.md?ref=1#comments)',
    '[About](https://shop.test/about.md)',
    '[Docs](https://shop.test/docs.md)',
    '[Deep](https://shop.test/docs/a/b.md)',
    '[Here](https://shop.test/page#links)',
    '[Twin](https://shop.test/blog/post.md)',
    '[API](https://shop.test/api/cart)',
    '[Logo](https://shop.test/logo.png)',
    '[Not a post](https://shop.test/blog/a/b)',
    '[Elsewhere](https://other.test/about)',
  ])
    expect(linked).toContain(link)

  // off, or without md()'s pages, links are as the page has them
  const off = await (
    await createMdHandler({ linkTwins: false })(new Request(`${site}/page.md`))
  ).text()
  expect(off).toContain('[Post](https://shop.test/blog/post?ref=1#comments)')
  delete process.env[ROUTES_ENV]
  expect(await (await get('/page')).text()).toContain('[About](https://shop.test/about/)')

  // a root catch-all matches every path, but api routes and next's internals are never pages
  process.env[ROUTES_ENV] = JSON.stringify(['/', '/[...slug]'])
  upstream = () =>
    new Response(
      page(
        '<h1>All</h1><p><a href="/api/cart">API</a> <a href="/_next/static/x.js">Chunk</a> <a href="/guide">Guide</a> <a href="/guide.md">Twin</a></p>',
      ),
      { headers: { 'content-type': 'text/html' } },
    )
  const caught = await (await get('/page')).text()
  expect(caught).toContain(
    '[API](https://shop.test/api/cart) [Chunk](https://shop.test/_next/static/x.js)',
  )
  expect(caught).toContain('[Guide](https://shop.test/guide.md) [Twin](https://shop.test/guide.md)')

  // a path that starts with //host once resolved (/.//evil.test/x) is twinned on this site, never another's
  upstream = () =>
    new Response(
      page(
        '<h1>Links</h1><p><a href="/.//evil.test/phish">A</a> <a href="/./\\evil.test/x">B</a> <a href="/a/..//evil.test/x">C</a></p>',
      ),
      { headers: { 'content-type': 'text/html' } },
    )
  const twins = await (await get('/page')).text()
  for (const [, href] of twins.matchAll(/\]\(([^)]+)\)/g))
    expect({ href, origin: new URL(href!).origin }).toEqual({ href, origin: site })
})

test('on a literalMd route, a link to a page named x.md is twinned like any page, as x.md.md', async () => {
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/x/:pkg']))
  process.env[ROUTES_ENV] = JSON.stringify(['/x/[pkg]', '/blog/[slug]'])
  upstream = () =>
    new Response(
      page(
        '<h1>Links</h1><p><a href="/x/readme.md">Readme</a> <a href="/x/express">Express</a> <a href="/blog/post.md">Post</a></p>',
      ),
      { headers: { 'content-type': 'text/html' } },
    )
  const text = await (await get('/page')).text()
  expect(text).toContain('[Readme](https://shop.test/x/readme.md.md)')
  expect(text).toContain('[Express](https://shop.test/x/express.md)')
  // off a literal route, a .md link is already a twin
  expect(text).toContain('[Post](https://shop.test/blog/post.md)')
})

// md({ aliases }): a registry whose proxy.ts merges /package/@scope/name into app/package/[pkg]
const registry = [
  'app/package/[pkg]/page.tsx',
  'app/package/[pkg]/versions/page.tsx',
  'app/package/[pkg]/version/[version]/page.tsx',
  'app/x/versions/page.tsx',
]
const scoped = {
  '/package/@:scope/:name/:rest*': '/package/@:scope%2F:name/:rest*',
}
const { prepareDestination } =
  require('next/dist/shared/lib/router/utils/prepare-destination.js') as {
    prepareDestination: (args: {
      destination: string
      params: Record<string, unknown>
      query: object
      appendParamsToQuery: boolean
    }) => { newUrl: string }
  }

test('md({ aliases }) checks each alias when the config loads, and says which one is wrong and how', () => {
  const dir = app(registry)
  const load = (aliases: Record<string, string>) => () => md({ root: dir, aliases })({} as Config)
  const config = load(scoped)()
  expect(JSON.parse(config.env![ALIASES_ENV]!)).toEqual(Object.entries(scoped))
  expect(md({ root: dir })({} as Config).env![ALIASES_ENV]).toBeUndefined()
  // a destination that can render a page for some value is fine: /x/:tab renders app/x/versions
  expect(load({ '/y/:tab': '/x/:tab' })).not.toThrow()
  const cases: [Record<string, string>, string][] = [
    [
      { '/package/@:scope/:name': '/packages/@:scope%2F:name' },
      "md({ aliases }): '/package/@:scope/:name': '/packages/@:scope%2F:name' renders no page in app/",
    ],
    [{ '/p/@:scope/:name': '/package/:name/a/b/c' }, 'renders no page in app/'],
    [{ '/p/:a': '/package/:b' }, "uses :b in its destination, which the source doesn't have"],
    [{ '/p/:a': 'https://other.test/package/:a' }, "isn't a path on this site"],
    [{ '/p/:a': '/package/:a?x=1' }, "isn't a path on this site"],
    [{ '/p/:a': '//other.test/package/:a' }, "isn't a path on this site"],
    [{ 'p/:a': '/package/:a' }, "has a source that isn't a path"],
    [{ '/p/(:a': '/package/:a' }, "isn't valid Next rewrite syntax"],
  ]
  for (const [aliases, message] of cases) expect(load(aliases)).toThrow(message)
})

test("an alias fills in its destination as next fills in a rewrite's, and matches as strictly as a page", () => {
  const aliases = { ...scoped, '/v/:a/:b*': '/x/:a/:b*' }
  vi.stubEnv(ALIASES_ENV, JSON.stringify(Object.entries(aliases)))
  for (const path of [
    '/package/@babel/core',
    '/package/@babel/core/versions',
    '/package/@babel/core/version/7.28.0',
    '/package/@x%3D1/a%20b',
    '/v/1',
    '/v/1/2/3',
  ]) {
    const [source, destination] = Object.entries(aliases).find(([from]) =>
      getPathMatch(from)(path),
    )!
    const params = getPathMatch(source)(path) as Record<string, unknown>
    const next = prepareDestination({ destination, params, query: {}, appendParamsToQuery: false })
    expect({ path, ours: aliasPath(path) }).toEqual({ path, ours: next.newUrl })
  }
  expect(aliasPath('/package/@babel/core')).toBe('/package/@babel%2Fcore')
  // the first alias that matches wins, in the order they're declared
  vi.stubEnv(
    ALIASES_ENV,
    JSON.stringify([
      ['/package/@:scope/:name/versions', '/package/:name/versions'],
      ...Object.entries(scoped),
    ]),
  )
  expect(aliasPath('/package/@babel/core/versions')).toBe('/package/core/versions')
  expect(aliasPath('/package/@babel/core')).toBe('/package/@babel%2Fcore')
  // next would route these case-insensitively or with an empty segment; a proxy.ts matcher may not see them
  for (const path of ['/Package/@babel/core', '/package/@babel//core', '/package/express'])
    expect({ path, ours: aliasPath(path) }).toEqual({ path, ours: undefined })
})

test("an alias's public url gets its Link header, its own twin doesn't", async () => {
  const rules = await md({
    root: app(registry),
    aliases: { ...scoped, '/package/@:scope/:name/versions': '/package/:name/versions' },
  })({} as Config).headers!()
  expect(linkOn(rules, '/package/@babel/core')).toBe(alternate('/package/@babel/core.md'))
  expect(linkOn(rules, '/package/@babel/core/versions')).toBe(
    alternate('/package/@babel/core/versions.md'),
  )
  expect(linkOn(rules, '/package/@babel/core/version/7.28.0')).toBe(
    alternate('/package/@babel/core/version/7.28.0.md'),
  )
  // its own twin isn't pointed at a .md.md, and a plain page keeps its own
  expect(linkOn(rules, '/package/@babel/core.md')).toBeUndefined()
  expect(linkOn(rules, '/package/@babel/core/versions.md')).toBeUndefined()
  expect(linkOn(rules, '/package/express')).toBe(alternate('/package/express.md'))
})

test("markdown.ts runs for an alias's public url, with params exactly as page.tsx gets them: still encoded", async () => {
  vi.stubEnv(ALIASES_ENV, JSON.stringify(Object.entries(scoped)))
  process.env[ROUTES_ENV] = JSON.stringify(['/package/[pkg]', '/package/[pkg]/versions'])
  const calls = markdownFiles({ '/package/[pkg]/versions': ({ params }) => `# ${params.pkg}` })
  const twin = await handler(new Request(`${site}/package/@babel/core/versions.md`))
  expect(await twin.text()).toContain('# %40babel%2Fcore')
  await handler(
    new Request(`${site}/package/@babel/core/versions`, { headers: { accept: 'text/markdown' } }),
  )
  await handler(new Request(`${site}/package/express/versions.md`))
  // next gives page.tsx { pkg: '%40babel%2Fcore' } for /package/@babel/core (next start, 16.3.0 and 16.4.3)
  expect(calls.map((call) => call.params)).toEqual([
    { pkg: '%40babel%2Fcore' },
    { pkg: '%40babel%2Fcore' },
    { pkg: 'express' },
  ])
  // never for a direct hit on the handler, or a url the alias doesn't match strictly: those render the page's html
  await handler(new Request(`${site}/api/affordances/md/package/@babel/core/versions`))
  await handler(new Request(`${site}/Package/@babel/core/versions.md`))
  expect(calls).toHaveLength(3)
  expect(seen.map((call) => call.url.pathname)).toEqual([
    '/package/@babel/core/versions',
    '/Package/@babel/core/versions',
  ])
})

test("links to an alias's public urls point at their twins, when the route they map onto is a page", async () => {
  vi.stubEnv(ALIASES_ENV, JSON.stringify(Object.entries(scoped)))
  process.env[ROUTES_ENV] = JSON.stringify(['/package/[pkg]', '/package/[pkg]/versions'])
  upstream = () =>
    new Response(
      page(
        '<h1>Core</h1><p><a href="/package/@babel/core/versions?page=2">Versions</a> <a href="/package/@babel/core">Overview</a> <a href="/package/@babel/core/nope">Nope</a></p>',
      ),
      { headers: { 'content-type': 'text/html' } },
    )
  const text = await (await get('/package/@babel/core')).text()
  expect(text).toContain('[Versions](https://shop.test/package/@babel/core/versions.md?page=2)')
  expect(text).toContain('[Overview](https://shop.test/package/@babel/core.md)')
  expect(text).toContain('[Nope](https://shop.test/package/@babel/core/nope)')
})

test('literalMd is declared in public url space, as the rewrites it feeds: an alias leaves it as it is', () => {
  vi.stubEnv(ALIASES_ENV, JSON.stringify(Object.entries(scoped)))
  // the route an alias maps onto doesn't make its public urls literal: /package/@scope/readme.md is a twin here
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/package/:pkg']))
  expect(mdRewrite(new Request(`${site}/package/@scope/readme.md`))!.pathname).toBe(
    '/api/affordances/md/package/@scope/readme',
  )
  // the public shape, listed as it is, does
  vi.stubEnv(LITERAL_ENV, JSON.stringify(['/package/:pkg', '/package/@:scope/:name']))
  expect(mdRewrite(new Request(`${site}/package/@scope/readme.md`))!.pathname).toBe(
    '/api/affordances/md/package/@scope/readme.md',
  )
  expect(mdRewrite(new Request(`${site}/blog/readme.md`))!.pathname).toBe(
    '/api/affordances/md/blog/readme',
  )
})

// slots: markdown.ts fills the <AgentSlot>s the page rendered, and the rest of the page converts as usual
const slot = (name: string, children = '<p>Loading…</p>') =>
  `<affordances-md data-mode="slot" data-name="${name}" style="display:contents">${children}</affordances-md>`
const slotted = (body: string) => () =>
  new Response(page(`<h1>Core</h1><p>Header the converter reads.</p>${body}`), {
    headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' },
  })
const markdownModule = (module: {
  default?: (args: { params: Record<string, string | string[]> }) => unknown
  slots?: Record<
    string,
    (args: {
      route: string
      params: Record<string, string | string[]>
      request: Request
    }) => unknown
  >
}) => {
  clear()
  const ran: string[] = []
  const slots =
    module.slots &&
    Object.fromEntries(
      Object.entries(module.slots).map(([name, fill]) => [
        name,
        (args: { route: string; params: Record<string, string | string[]>; request: Request }) => {
          ran.push(name)
          return fill(args)
        },
      ]),
    )
  authored['/x/[pkg]'] = async () => ({ ...module, ...(slots && { slots }) }) as never
  process.env[ROUTES_ENV] = JSON.stringify(['/x/[pkg]', '/sign-in'])
  return ran
}

test('slots fill the markers the page rendered, and the rest of the page converts as usual', async () => {
  upstream = slotted(slot('readme'))
  const ran = markdownModule({
    slots: {
      readme: ({ route, params }) => `## Readme\n\nThe readme of ${params.pkg}, on ${route}.`,
    },
  })
  const response = await handler(new Request(`${site}/x/%40babel%2Fcore.md`))
  const text = await response.text()
  expect(text).toContain(
    // its args say which route matched, as the route string md() found
    '# Core\n\nHeader the converter reads.\n\n## Readme\n\nThe readme of %40babel%2Fcore, on /x/[pkg].',
  )
  expect(text).not.toContain('Loading')
  expect(ran).toEqual(['readme'])
  // the page rendered once, then the fill ran; a fill reads data as the request's markdown.ts does: never cached
  expect(seen.map((call) => call.url.pathname)).toEqual(['/x/%40babel%2Fcore'])
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  // in the visitor's request: signed in, it's theirs
  const signedIn = await handler(new Request(`${site}/x/a.md`, { headers: { cookie: 'sid=1' } }))
  expect(signedIn.headers.get('x-affordances-md-personal')).toBe('1')
})

test('the default export runs first: anything but undefined is the whole page, and no slot runs', async () => {
  upstream = slotted(slot('readme'))
  const ran = markdownModule({ default: () => '# Whole page', slots: { readme: () => 'fill' } })
  expect(await (await handler(new Request(`${site}/x/a.md`))).text()).toContain('# Whole page')
  expect([ran, seen]).toEqual([[], []])
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const fallsBack = markdownModule({ default: () => undefined, slots: { readme: () => 'Filled.' } })
  expect(await (await handler(new Request(`${site}/x/a.md`))).text()).toContain('Filled.')
  expect(fallsBack).toEqual(['readme'])
  // with slots, undefined is the intended way to hand the page back: not a mistake to warn about
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

test("only the names the page rendered once, where they reach the markdown, run; what doesn't line up is said in development", async () => {
  const skipped = `<affordances-md data-mode="skip" style="display:contents">${slot('hidden')}</affordances-md>`
  upstream = slotted(
    `${slot('readme')}${slot('twice')}${slot('twice')}${slot('nofill')}${slot('empty')}${slot('constructor')}${skipped}`,
  )
  const ran = markdownModule({
    slots: {
      readme: () => 'Filled.',
      twice: () => 'never',
      hidden: () => 'never',
      versions: () => 'never',
      empty: () => undefined,
    },
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const text = await (await handler(new Request(`${site}/x/a.md`))).text()
  const warnings = warn.mock.calls.map(([message]) => String(message))
  warn.mockRestore()
  expect(ran.toSorted()).toEqual(['empty', 'readme'])
  expect(text).toContain('Filled.')
  // a duplicate, an unfilled marker and an empty fill convert their own children; a name off Object.prototype is none
  expect(text.match(/Loading…/g)).toHaveLength(5)
  expect(text).not.toContain('never')
  const where = '[affordances-md] /x/[pkg]/markdown.ts, /x/a:'
  expect(warnings.toSorted()).toEqual(
    [
      `${where} <AgentSlot name="twice"> is on the page more than once, so no copy is filled and each converts as usual. Give each slot its own name.`,
      `${where} slots.hidden has no <AgentSlot name="hidden"> on the page, so it didn't run.`,
      `${where} slots.versions has no <AgentSlot name="versions"> on the page, so it didn't run.`,
      `${where} <AgentSlot name="nofill"> has no slots.nofill, so its own content is converted.`,
      `${where} <AgentSlot name="constructor"> has no slots.constructor, so its own content is converted.`,
      `${where} slots.empty returned nothing, so the slot's own content is converted.`,
    ].toSorted(),
  )
  // a marker outside <AgentMain> never reaches the markdown either, so its fill never runs
  upstream = slotted(
    `<affordances-md data-mode="main" style="display:contents">${slot('readme')}</affordances-md>${slot('aside')}`,
  )
  const main = markdownModule({ slots: { readme: () => 'Main.', aside: () => 'never' } })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await (await handler(new Request(`${site}/x/a.md`))).text()).toContain('Main.')
  vi.restoreAllMocks()
  expect(main).toEqual(['readme'])
})

test("a fill's notFound() or redirect() answers for the whole page; the page's own redirect means no fill runs", async () => {
  const navigation = await import('next/navigation.js')
  upstream = slotted(slot('readme'))
  markdownModule({ slots: { readme: () => navigation.notFound() } })
  const missing = await handler(new Request(`${site}/x/a.md`))
  expect([missing.status, await missing.text()]).toEqual([404, '# Not found\n'])
  markdownModule({ slots: { readme: () => navigation.redirect('/sign-in') } })
  const login = await handler(new Request(`${site}/x/a.md`))
  expect([login.status, login.headers.get('location')]).toEqual([307, '/sign-in.md'])
  // the page redirects (its layout's gate), so it never rendered its slots
  upstream = () => new Response(null, { status: 307, headers: { location: '/sign-in' } })
  const ran = markdownModule({ slots: { readme: () => 'never' } })
  expect((await handler(new Request(`${site}/x/a.md`))).headers.get('location')).toBe('/sign-in.md')
  expect(ran).toEqual([])
})

test("a direct hit on the handler converts the slots' own content: no fill runs, as no markdown.ts does", async () => {
  upstream = slotted(slot('readme'))
  const ran = markdownModule({ slots: { readme: () => 'never' } })
  const text = await (await get('/x/a')).text()
  expect(text).toContain('Loading…')
  expect(ran).toEqual([])
})

// intake's /code-review of 0.3.0: alias and Link-rule shapes next fills differently
test('a Link rule fills every shape of param next can match: repeated ones mid-source, absent optional ones, patterned ones', async () => {
  const rules = await md({
    root: app([
      'app/docs/[...slug]/page.tsx',
      'app/package/[name]/page.tsx',
      'app/a/[b]/[[...c]]/page.tsx',
    ]),
    aliases: {
      '/d/:path+/edit': '/docs/:path+',
      '/:locale(en|fr)?/pkg/:name': '/package/:name',
      '/a/:b(x)/:c(y)*': '/a/:b/:c*',
    },
  })({} as Config).headers!()
  // next throws on a repeated param written without its + (a 500 on every matching request): A1
  expect(linkOn(rules, '/d/a/b/edit')).toBe(alternate('/d/a/b/edit.md'))
  expect(linkOn(rules, '/d/a/edit')).toBe(alternate('/d/a/edit.md'))
  // an absent optional param mid-source isn't left as a literal :locale: A2
  expect(linkOn(rules, '/pkg/x')).toBe(alternate('/pkg/x.md'))
  expect(linkOn(rules, '/en/pkg/x')).toBe(alternate('/en/pkg/x.md'))
  // a patterned optional tail splits off at its own param, not the one before: A3
  expect(linkOn(rules, '/a/x')).toBe(alternate('/a/x.md'))
  expect(linkOn(rules, '/a/x/y')).toBe(alternate('/a/x/y.md'))
  // never a literal param in any value
  for (const rule of rules)
    for (const { value } of rule.headers)
      expect({ source: rule.source, value }).not.toEqual({
        source: rule.source,
        value: expect.stringMatching(/<[^>]*:\w+[?*]/),
      })
})

test('alias shapes that render a page load: the root page, a trailing slash, an optional param; unnamed params count as next counts them', () => {
  const dir = app(['app/page.tsx', 'app/p/[a]/page.tsx', 'app/p/[a]/[tab]/page.tsx'])
  // A4: an alias to / or to a path with a trailing slash; A5: an optional param in the destination
  const loads: Record<string, string>[] = [
    { '/:locale(en|fr)': '/' },
    { '/x/:a': '/p/:a/' },
    { '/q/:name/:tab?': '/p/:name/:tab?' },
  ]
  for (const aliases of loads) expect(() => md({ root: dir, aliases })({} as Config)).not.toThrow()
  // still a path with no query or hash
  expect(() => md({ root: dir, aliases: { '/q/:a': '/p/:a?x=1' } })({} as Config)).toThrow(
    "isn't a path on this site",
  )
  // A6: path-to-regexp numbers only the params that capture, so a {group} of plain text takes no number
  expect(sourceParams('/a{/b}?/(.*)')).toEqual(['0'])
  expect(sourceParams('/a{/b}?/(.*)')).toEqual(
    Object.keys(getPathMatch('/a{/b}?/(.*)')('/a/b/c') as object).filter((key) =>
      /^\d+$/.test(key),
    ),
  )
})

test("md() never throws for config-time I/O: app/ it couldn't read, or a tsconfig.json it couldn't read", () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  // A7: no app/ to check aliases against (a wrong root, or a node without getBuiltinModule): said, not thrown
  const empty = app([])
  expect(() => md({ root: empty, aliases: { '/p/:a': '/package/:a' } })({} as Config)).not.toThrow()
  expect(warn.mock.calls.map(([message]) => String(message))).toContainEqual(
    expect.stringContaining("md({ aliases }) can't check that each alias renders a page"),
  )
  // A8: a tsconfig.json that can't be read at all (a directory where the file should be)
  const dir = app(['app/x/[pkg]/page.tsx', 'app/x/[pkg]/markdown.ts', 'tsconfig.json/keep'])
  warn.mockClear()
  expect(() => md({ root: dir })({} as Config)).not.toThrow()
  expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
    `[affordances-md] tsconfig.json couldn't be read, so tsc can't check each markdown.ts against its route. Add ".affordances/**/*.ts" to its "include".`,
  ])
  warn.mockRestore()
})

test('A9: a redirect for a markdown request goes to a twin only when its target has one, on every path', async () => {
  const navigation = await import('next/navigation.js')
  process.env[ROUTES_ENV] = JSON.stringify(['/x/[pkg]', '/sign-in'])
  // a page, an api route (NextAuth's sign-in), a route handler that isn't a page (Auth0's /auth/login), a file
  const targets = ['/sign-in?next=%2Fx', '/api/auth/signin?next=%2Fx', '/auth/login', '/report.pdf']
  const expected = [
    '/sign-in.md?next=%2Fx',
    '/api/auth/signin?next=%2Fx',
    '/auth/login',
    '/report.pdf',
  ]
  // the page's own 3xx
  for (const [i, location] of targets.entries()) {
    upstream = redirect(location)
    expect((await get('/x/a')).headers.get('location')).toBe(expected[i])
  }
  // a redirect() streamed after the shell
  for (const [i, location] of targets.entries()) {
    upstream = streamedRedirect(location.replace('&', '&amp;'))
    expect((await handler(new Request(`${site}/x/a.md`))).headers.get('location')).toBe(expected[i])
  }
  // a redirect() thrown in markdown.ts
  for (const [i, location] of targets.entries()) {
    markdownFiles({ '/x/[pkg]': () => navigation.redirect(location) })
    expect((await handler(new Request(`${site}/x/a.md`))).headers.get('location')).toBe(expected[i])
  }
  // md.redirect from a proxy
  for (const [i, location] of targets.entries())
    expect(
      mdProxy(new Request(`${site}/x/a.md`))
        .redirect(location)
        .headers.get('location'),
    ).toBe(new URL(expected[i]!, site).href)
  // without md()'s pages every page url still has one, as before; an api route never does
  delete process.env[ROUTES_ENV]
  upstream = redirect('/auth/login')
  expect((await get('/x/a')).headers.get('location')).toBe('/auth/login.md')
  upstream = redirect('/api/auth/signin')
  expect((await get('/x/a')).headers.get('location')).toBe('/api/auth/signin')
})

test('A10: a slot inside another slot never reaches the markdown, so its fill never runs or decides the page', async () => {
  const navigation = await import('next/navigation.js')
  upstream = slotted(slot('outer', `<p>Outer.</p>${slot('inner')}`))
  const ran = markdownModule({
    slots: { outer: () => 'Filled outer.', inner: () => navigation.notFound() },
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const response = await handler(new Request(`${site}/x/a.md`))
  vi.restoreAllMocks()
  expect([response.status, ran]).toEqual([200, ['outer']])
  expect(await response.text()).toContain('Filled outer.')
})

test('A12, documented: a forged slot marker in user html runs its fill even where the page left the slot out, so a fill authorizes its own data', async () => {
  // the page renders billing only for its owner (here, not), and a README with a forged billing marker in it
  upstream = slotted(`<section>${slot('billing', '<p>forged</p>')}</section>`)
  const asked: (string | null)[] = []
  const ran = markdownModule({
    // the documented shape: the fill checks who's asking, whatever the page rendered
    slots: {
      billing: ({ request }) => {
        asked.push(request.headers.get('cookie'))
        return request.headers.get('cookie') === 'session=owner' ? '**Plan:** Pro' : undefined
      },
    },
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const visitor = await (
    await handler(new Request(`${site}/x/a.md`, { headers: { cookie: 'session=visitor' } }))
  ).text()
  vi.restoreAllMocks()
  // the fill ran for the visitor, in their own request, and gave nothing it hadn't authorized
  expect(ran).toEqual(['billing'])
  expect(asked).toEqual(['session=visitor'])
  expect(visitor).not.toContain('Plan')
})

test("a markdown.ts is left out only when its text makes plain it can't fit: anything that may fit is kept", () => {
  // plainly none of default and slots: the names it does export, for the error
  expect(unfitExports('export const methodology = { steps: 3 }\n')).toEqual(['methodology'])
  expect(
    unfitExports(
      'export async function load() {}\nexport class Steps {}\nconst a = 1, b = 2\nexport { a, b as c, type T }\n',
    ),
  ).toEqual(['load', 'Steps', 'a', 'c'])
  // may fit: kept, and the generated check judges it as before
  const fits = [
    'export default function markdown() { return "# Hi" }',
    'const markdown = () => "# Hi"\nexport { markdown as default }',
    'export { default } from "../shared/markdown.ts"',
    'export const slots = { readme: () => "## Readme" }',
    'export * from "../shared/markdown.ts"',
    'module.exports = { default: () => "# Hi" }',
    'exports.slots = {}',
    // nothing exported yet, as a file just made in next dev, is as it was
    '',
    'const helper = 1',
    // a mention anywhere, even a comment, is enough to keep it
    '// TODO: a default export\nexport const steps = 3',
  ]
  expect(Object.fromEntries(fits.map((source) => [source, unfitExports(source)]))).toEqual(
    Object.fromEntries(fits.map((source) => [source, undefined])),
  )
})

test("a title is the heading's text: a link keeps its text, and a url shown as itself is dropped", async () => {
  const titled = async (heading: string) => {
    markdownFiles({ '/methodology': () => `${heading}\n\nHow we measure.` })
    const text = await (await handler(new Request(`${site}/methodology.md`))).text()
    return /^title: (.+)$/m.exec(text)?.[1]
  }
  expect(await titled('# [Methodology](https://shop.test/methodology)')).toBe('"Methodology"')
  expect(await titled('# Methodology (https://shop.test/methodology)')).toBe('"Methodology"')
  expect(await titled('# Methodology <https://shop.test/methodology>')).toBe('"Methodology"')
  expect(await titled('# **How** we `measure` [it](/m) ![chart](/c.png)')).toBe(
    '"How we measure it"',
  )
  // the heading's own text exactly, brackets, code and raw html included
  expect(await titled('# Tom &amp; Jerry <span>live</span>')).toBe(
    '"Tom & Jerry <span>live</span>"',
  )
  expect(await titled('# useState()')).toBe('"useState()"')
  expect(await titled('# `code()` title')).toBe('"code() title"')
  expect(await titled('# [Title](https://shop.test/t)')).toBe('"Title"')
  expect(await titled('# Array<T>')).toBe('"Array<T>"')
  expect(await titled('# [] empty')).toBe('"[] empty"')
  expect(await titled('# Map<K, V> (https://shop.test/map)')).toBe('"Map<K, V>"')
  // its text read as a heading's, never as the list, rule or setext marker it would be on its own
  expect(await titled('# 1. Introduction')).toBe('"1. Introduction"')
  expect(await titled('# 2024. A year in review')).toBe('"2024. A year in review"')
  expect(await titled('# - Draft')).toBe('"- Draft"')
  expect(await titled('# ---')).toBe('"---"')
  // a www. autolink and a percent-encoded url are urls shown as themselves too
  expect(await titled('# Docs (www.example.com)')).toBe('"Docs"')
  expect(await titled('# Menu <https://shop.test/café>')).toBe('"Menu"')
  // the first heading outside fenced code
  expect(await titled('```sh\n# not a heading\n```\n\n# Install')).toBe('"Install"')

  // a link whose text isn't its url keeps it, as any text does
  expect(await titled('# Read [shop.test](https://shop.test/about)')).toBe('"Read shop.test"')
  // the page's own markdown is left as it is
  markdownFiles({ '/methodology': () => '# [Methodology](https://shop.test/methodology)\n\nHow.' })
  expect(await (await handler(new Request(`${site}/methodology.md`))).text()).toContain(
    '\n# [Methodology](https://shop.test/methodology)\n',
  )
  // llms-full heads the page with the same text
  const full = await createLlmsFullHandler({ pages: () => ['/methodology'] })(
    new Request(`${site}/llms-full.txt`),
  )
  expect(await full.text()).toBe(`# Methodology (${site}/methodology)\n\nHow.\n`)
})

// llms's own fetches, answered as the md route would: markdown with its frontmatter, as each path says
const llmsPages = (answer: (path: string, signal: AbortSignal) => Response | Promise<Response>) => {
  let inFlight = 0
  const most = { value: 0 }
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    // llms asks for each page's twin: the page it's for
    const path = mdPagePath(new URL(url).pathname)
    if (path === '/.well-known/affordances.json') return new Response('', { status: 404 })
    inFlight++
    most.value = Math.max(most.value, inFlight)
    try {
      return await answer(path, init.signal!)
    } finally {
      inFlight--
    }
  })
  return most
}
const mdPage = (title: string, body: string, headers: Record<string, string> = {}) =>
  new Response(`---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}\n`, {
    headers: { 'content-type': 'text/markdown; charset=utf-8', ...headers },
  })

test('llms renders a few pages at a time, 8 by default, each with its own timeout, in order', async () => {
  const paths = Array.from({ length: 20 }, (_, i) => `/p${i}`)
  const most = llmsPages(async (path) => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return mdPage(`Page ${path}`, `# Page ${path}\n\nBody.`)
  })
  const text = await (
    await createLlmsFullHandler({ pages: () => paths })(new Request(`${site}/llms-full.txt`))
  ).text()
  expect(most.value).toBe(8)
  expect(text.match(/^# Page \/p\d+/gm)).toEqual(paths.map((path) => `# Page ${path}`))
  most.value = 0
  await createLlmsTxtHandler({ concurrency: 2, sections: () => [{ title: 'All', pages: paths }] })(
    new Request(`${site}/llms.txt`),
  )
  expect(most.value).toBe(2)
  // each page's timeout runs from its own fetch: 20 pages of 5ms each, two at a time, all fit in 30ms apiece
  const slow = await createLlmsFullHandler({ pages: () => paths, concurrency: 2, timeout: 30 })(
    new Request(`${site}/llms-full.txt`),
  )
  expect(slow.headers.has('x-affordances-md-dropped')).toBe(false)
  expect(() => createLlmsFullHandler({ concurrency: 0 })).toThrow(
    '[affordances-md] concurrency is how many pages render at once, a whole number from 1; got 0',
  )
  expect(() => createLlmsTxtHandler({ concurrency: 1.5 })).toThrow(/got 1\.5$/)
})

// one page that renders, and one of each way a page is left out by design
const pages = () => ['/fine', '/gone', '/moved', '/file', '/errored', '/mine', '//evil.test/x']
const leftOut = (path: string) =>
  path === '/gone'
    ? new Response('', { status: 404 })
    : path === '/moved'
      ? new Response(null, { status: 307, headers: { location: '/fine' } })
      : path === '/file'
        ? new Response('{}', { headers: { 'content-type': 'application/json' } })
        : path === '/mine'
          ? mdPage('Mine', '# Mine', { 'x-affordances-md-personal': '1' })
          : path === '/errored'
            ? mdPage('Errored', '# Errored\n\nLoading…', { 'x-affordances-md-error': '1' })
            : mdPage('Fine', '# Fine\n\nBody.')

test('a page llms leaves out by design is named, with why, in development, and the file stays public', async () => {
  llmsPages(leftOut)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const full = await createLlmsFullHandler({ pages })(new Request(`${site}/llms-full.txt`))
  expect(full.status).toBe(200)
  expect(await full.text()).toBe(`# Fine (${site}/fine)\n\nBody.\n`)
  expect(full.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600')
  expect(full.headers.has('x-affordances-md-dropped')).toBe(false)
  expect(warn.mock.calls.map(([message]) => message)).toEqual([
    '[affordances-md] llms-full.txt left out 5 pages: /gone (answered 404), /moved (answered 307), /file (answered application/json, not markdown), /errored (a boundary on it caught an error), //evil.test/x (not on this site)',
  ])
  // a private page is usually one meant to be public: an error that says what keeps it out
  expect(error.mock.calls.map(([message]) => message)).toEqual([
    '[affordances-md] llms-full.txt left out /mine: its markdown is private, since it was rendered with credentials, or it set a cookie. The llms files are public, so a page is in them only when it renders without credentials and sets no cookie, the view publicCache in its markdown.ts makes public.',
  ])
  // llms.txt still links each, by its path
  warn.mockClear()
  const index = await createLlmsTxtHandler({
    title: 'Shop',
    sections: () => [{ title: 'All', pages: pages() }],
  })(new Request(`${site}/llms.txt`))
  expect(await index.text()).toContain(`- [/gone](${site}/gone.md)`)
  expect(index.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600')
  expect(index.headers.has('x-affordances-md-dropped')).toBe(false)
  expect(String(warn.mock.calls[0]?.[0])).toMatch(
    /^\[affordances-md\] llms\.txt left out 5 pages: \/gone/,
  )
  // in production: nothing logged
  vi.stubEnv('NODE_ENV', 'production')
  warn.mockClear()
  error.mockClear()
  const quiet = await createLlmsFullHandler({ pages })(new Request(`${site}/llms-full.txt`))
  expect([quiet.status, await quiet.text()]).toEqual([200, `# Fine (${site}/fine)\n\nBody.\n`])
  expect([...warn.mock.calls, ...error.mock.calls]).toEqual([])
  vi.unstubAllEnvs()
  warn.mockRestore()
  error.mockRestore()
})

// each way a page fails, and may render next time
const failing: Record<string, (signal: AbortSignal) => Response | Promise<Response>> = {
  '/slow': (signal) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  '/broken': () => new Response('', { status: 500 }),
  '/busy': () => new Response('', { status: 429 }),
  '/partial': () => mdPage('Partial', '# Partial\n\nHalf.', { 'x-affordances-md-partial': '1' }),
  '/refused': () => Promise.reject(new TypeError('fetch failed')),
}

test('llms-full with a page that failed is a 503 no cache keeps, with the count only', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  for (const [path, answer] of Object.entries(failing)) {
    llmsPages((at, signal) => (at === path ? answer(signal) : mdPage('Fine', '# Fine\n\nBody.')))
    const full = await createLlmsFullHandler({ pages: () => ['/fine', path], timeout: 20 })(
      new Request(`${site}/llms-full.txt`),
    )
    expect([path, full.status, await full.text()]).toEqual([
      path,
      503,
      "llms-full.txt is incomplete: 1 page couldn't be rendered. Retry in 30 seconds.\n",
    ])
    expect(Object.fromEntries(full.headers)).toMatchObject({
      'cache-control': 'no-store',
      'retry-after': '30',
      'x-affordances-md-dropped': '1',
    })
  }
  expect(warn.mock.calls.map(([message]) => message)).toEqual([
    "[affordances-md] llms-full.txt couldn't render 1 page: /slow (took longer than 20ms)",
    "[affordances-md] llms-full.txt couldn't render 1 page: /broken (answered 500)",
    "[affordances-md] llms-full.txt couldn't render 1 page: /busy (answered 429)",
    "[affordances-md] llms-full.txt couldn't render 1 page: /partial (still loading after 20ms)",
    "[affordances-md] llms-full.txt couldn't render 1 page: /refused (failed: TypeError: fetch failed)",
  ])
  // with a page left out by design as well, only the failed one counts
  llmsPages((at, signal) => (at === '/slow' ? failing['/slow']!(signal) : leftOut(at)))
  const both = await createLlmsFullHandler({ pages: () => ['/slow', ...pages()], timeout: 20 })(
    new Request(`${site}/llms-full.txt`),
  )
  expect([both.status, both.headers.get('x-affordances-md-dropped')]).toEqual([503, '1'])
  // never private either way: credentials make no difference to a file that isn't whole
  const signedIn = await createLlmsFullHandler({
    pages: () => ['/slow'],
    timeout: 20,
    headers: { authorization: 'Bearer svc' },
  })(new Request(`${site}/llms-full.txt`))
  expect([signedIn.status, signedIn.headers.get('cache-control')]).toEqual([503, 'no-store'])
  warn.mockRestore()
})

test('a 503 from llms-full is said in production too, once per process, naming the pages and why', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  llmsPages((at, signal) => (at === '/slow' ? failing['/slow']!(signal) : mdPage('Fine', '# Fine')))
  for (let i = 0; i < 2; i++) {
    const full = await createLlmsFullHandler({ pages: () => ['/fine', '/slow'], timeout: 20 })(
      new Request(`${site}/llms-full.txt`),
    )
    // the body is the count only: the file is public, and a page's name could be private
    expect([full.status, await full.text()]).toEqual([
      503,
      "llms-full.txt is incomplete: 1 page couldn't be rendered. Retry in 30 seconds.\n",
    ])
  }
  expect(warn.mock.calls.map(([message]) => message)).toEqual([
    "[affordances-md] llms-full.txt answered 503: /slow (took longer than 20ms). It's never cached until every page renders: raise the deadline and the route's maxDuration, or cache the pages' twins.",
  ])
  warn.mockRestore()
  vi.unstubAllEnvs()
})

const cache = async (llms: (request: Request) => Promise<Response>) =>
  (await llms(new Request(`${site}/llms-full.txt`))).headers.get('cache-control')
const fine = () => ['/fine']

test("llms-full starts the site's own markdown alongside the renders, and an append that throws makes it a 503", async () => {
  const events: string[] = []
  llmsPages(async (path) => {
    events.push(`render ${path}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
    events.push(`rendered ${path}`)
    return mdPage('Slow', '# Slow')
  })
  await createLlmsFullHandler({
    pages: () => [
      '/slow',
      { url: '/given', markdown: () => (events.push('markdown()'), '# Given') },
    ],
    append: () => (events.push('append'), undefined),
  })(new Request(`${site}/llms-full.txt`))
  // both before the render is done, not after it
  expect(events.indexOf('markdown()')).toBeLessThan(events.indexOf('rendered /slow'))
  expect(events.indexOf('append')).toBeLessThan(events.indexOf('rendered /slow'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const broken = await createLlmsFullHandler({
    pages: () => ['/slow'],
    append: () => {
      throw new Error('cms down')
    },
  })(new Request(`${site}/llms-full.txt`))
  expect([broken.status, broken.headers.get('cache-control')]).toEqual([503, 'no-store'])
  // a page url that doesn't parse fails it the same way, never as a rejection no one awaits
  const rejected: unknown[] = []
  const onRejection = (reason: unknown) => rejected.push(reason)
  process.on('unhandledRejection', onRejection)
  const bad = await createLlmsFullHandler({
    pages: () => ['/slow', { url: 'http://[', markdown: '# Bad' }],
  })(new Request(`${site}/llms-full.txt`))
  await new Promise((resolve) => setTimeout(resolve, 0))
  process.off('unhandledRejection', onRejection)
  expect([bad.status, rejected]).toEqual([503, []])
  warn.mockRestore()
})

test('llms-full takes pages with their markdown given, never rendered, and append at the end', async () => {
  const fetched: string[] = []
  llmsPages((path) => {
    fetched.push(path)
    // as its markdown route sends it: links already resolved
    return mdPage('Guide', `# Guide\n\nRead [the changelog](${site}/changelog.md).`)
  })
  vi.stubEnv(ROUTES_ENV, JSON.stringify(['/', '/guide', '/changelog', '/package/[name]']))
  const full = await createLlmsFullHandler({
    pages: () => [
      '/guide',
      // a string, its title given
      {
        url: '/changelog',
        title: 'Changelog',
        markdown: '## 1.0\n\nSee [the guide](/guide) and [npm](https://npmjs.com).',
      },
      // a function of the request, named by its own heading
      {
        url: '/package/express',
        markdown: async (request) => `# express\n\nAsked at ${new URL(request.url).pathname}.`,
      },
    ],
    append: () => `# Support (${site}/support)\n\nEmail us.`,
  })(new Request(`${site}/llms-full.txt`))
  expect(await full.text()).toBe(
    [
      `# Guide (${site}/guide)\n\nRead [the changelog](${site}/changelog.md).`,
      // its links made absolute and twinned, as a rendered page's are
      `# Changelog (${site}/changelog)\n\n## 1.0\n\nSee [the guide](${site}/guide.md) and [npm](https://npmjs.com/).`,
      `# express (${site}/package/express)\n\nAsked at /llms-full.txt.`,
      `# Support (${site}/support)\n\nEmail us.\n`,
    ].join('\n\n'),
  )
  expect(fetched).toEqual(['/guide'])
  // a markdown() that throws is a page that failed: the file isn't whole
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const broken = await createLlmsFullHandler({
    pages: () => [
      {
        url: '/package/x',
        markdown: () => {
          throw new Error('registry down')
        },
      },
    ],
  })(new Request(`${site}/llms-full.txt`))
  expect([broken.status, broken.headers.get('x-affordances-md-dropped')]).toEqual([503, '1'])
  expect(String(warn.mock.calls[0]?.[0])).toContain(
    '/package/x (markdown() threw: Error: registry down)',
  )
  warn.mockRestore()
  vi.unstubAllEnvs()
})

test("the llms files are the public site whoever asks: what the app gives sees no visitor's headers, and a credentialed caller's copy is private", async () => {
  llmsPages(() => mdPage('Guide', '# Guide\n\nBody.'))
  const heard: string[] = []
  const who = (request: Request) => {
    const said = `cookie=${request.headers.get('cookie') ?? 'none'} auth=${request.headers.get('authorization') ?? 'none'}`
    heard.push(said)
    return said
  }
  const full = createLlmsFullHandler({
    pages: (request) => {
      who(request)
      return [
        '/guide',
        { url: '/who', title: 'Who', markdown: (asked) => `# Who\n\n${who(asked)}` },
      ]
    },
    append: (request) => `# Appended (${site}/appended)\n\n${who(request)}`,
  })
  const index = createLlmsTxtHandler({
    sections: (request) => [{ title: who(request), pages: ['/guide'] }],
  })
  for (const headers of [
    {},
    { cookie: 'session=alice' },
    { authorization: 'Bearer alice-token' },
  ] as Record<string, string>[]) {
    const caller = Object.keys(headers).length > 0
    for (const [llms, file] of [
      [full, 'llms-full.txt'],
      [index, 'llms.txt'],
    ] as const) {
      const response = await llms(new Request(`${site}/${file}`, { headers }))
      const body = await response.text()
      expect(body).not.toContain('alice')
      expect([file, headers, response.headers.get('cache-control')]).toEqual([
        file,
        headers,
        caller ? 'private, no-store' : 'public, max-age=0, s-maxage=3600',
      ])
    }
  }
  expect(new Set(heard)).toEqual(new Set(['cookie=none auth=none']))
})

test("llms asks for each page's twin directly, follows no redirect, and lets go of a body it doesn't read", async () => {
  const fetched: string[] = []
  let cancelled = 0
  const unread = () =>
    new ReadableStream({
      start: (controller) => controller.enqueue(new Uint8Array(8)),
      cancel: () => void cancelled++,
    })
  vi.stubGlobal('fetch', async (url: URL) => {
    const at = new URL(url).pathname
    fetched.push(at)
    if (at === '/.well-known/affordances.json') return new Response('', { status: 404 })
    if (at === '/away.md')
      return new Response(unread(), { status: 307, headers: { location: '/elsewhere.md' } })
    if (at === '/gone.md') return new Response(unread(), { status: 404 })
    return mdPage(`Page ${at}`, `# Page ${at}\n\nBody.`)
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const full = await createLlmsFullHandler({ pages: () => ['/', '/public', '/away', '/gone'] })(
    new Request(`${site}/llms-full.txt`),
  )
  expect(await full.text()).toBe(
    `# Page /index.md (${site}/)\n\nBody.\n\n# Page /public.md (${site}/public)\n\nBody.\n`,
  )
  // each twin once, never a redirect's target
  expect(fetched.filter((at) => !at.startsWith('/.well-known')).toSorted()).toEqual([
    '/away.md',
    '/gone.md',
    '/index.md',
    '/public.md',
  ])
  expect(cancelled).toBe(2)
  warn.mockRestore()
})

test('publicCache on the llms handlers sets how long a CDN keeps the file, never a file that failed or has credentials', async () => {
  llmsPages((at, signal) => (at === '/slow' ? failing['/slow']!(signal) : mdPage('Fine', '# Fine')))
  expect(await cache(createLlmsFullHandler({ pages: fine }))).toBe(
    'public, max-age=0, s-maxage=3600',
  )
  expect(await cache(createLlmsFullHandler({ pages: fine, publicCache: 'hours' }))).toBe(
    's-maxage=3600, stale-while-revalidate=82800',
  )
  expect(
    await cache(
      createLlmsTxtHandler({ full: false, publicCache: { revalidate: 600, expire: 86_400 } }),
    ),
  ).toBe('s-maxage=600, stale-while-revalidate=85800')
  expect(await cache(createLlmsTxtHandler({ publicCache: false }))).toBe('private, no-store')
  // revalidate 0 is never cached, as for a page
  expect(await cache(createLlmsTxtHandler({ publicCache: { revalidate: 0 } }))).toBe(
    'private, no-store',
  )
  // never kept: a file missing a page that failed, or one rendered with credentials
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(
    await cache(
      createLlmsFullHandler({ pages: () => ['/slow'], timeout: 20, publicCache: 'days' }),
    ),
  ).toBe('no-store')
  warn.mockRestore()
  expect(
    await cache(
      createLlmsFullHandler({ pages: fine, publicCache: 'days', headers: { cookie: 'sid=svc' } }),
    ),
  ).toBe('private, no-store')
  // a value that isn't one is a mistake to say when the handler is made
  expect(() => createLlmsFullHandler({ publicCache: 'hourly' })).toThrow(
    "[affordances-md] publicCache 'hourly' isn't a cacheLife profile. It can be one of Next's cacheLife profiles ('default', 'seconds', 'minutes', 'hours', 'days', 'weeks', 'max') or { revalidate, expire? } in seconds, or false",
  )
  // @ts-expect-error: a revalidate in seconds
  expect(() => createLlmsTxtHandler({ publicCache: { revalidate: '1h' } })).toThrow(
    /^\[affordances-md\] publicCache needs revalidate, in seconds\./,
  )
})

test('llms.txt with a page that failed links it by its path, stays cacheable, and counts it', async () => {
  const paths = ['/fine', ...Object.keys(failing)]
  llmsPages((at, signal) => failing[at]?.(signal) ?? mdPage('Fine', '# Fine\n\nBody.'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const index = await createLlmsTxtHandler({
    title: 'Shop',
    timeout: 20,
    sections: () => [{ title: 'All', pages: paths }],
  })(new Request(`${site}/llms.txt`))
  expect(index.status).toBe(200)
  // a partial page's title still names it
  expect((await index.text()).match(/^- .+$/gm)).toEqual([
    `- [Fine](${site}/fine.md)`,
    `- [/slow](${site}/slow.md)`,
    `- [/broken](${site}/broken.md)`,
    `- [/busy](${site}/busy.md)`,
    `- [Partial](${site}/partial.md)`,
    `- [/refused](${site}/refused.md)`,
  ])
  expect(index.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600')
  expect(index.headers.get('x-affordances-md-dropped')).toBe('5')
  expect(String(warn.mock.calls[0]?.[0])).toMatch(
    /^\[affordances-md\] llms\.txt couldn't render 5 pages: \/slow/,
  )
  warn.mockRestore()
})

test("llms-full puts the url on the page's # heading itself, as written, wherever a ## comes first", async () => {
  llmsPages(
    (path) =>
      ({
        '/dollar': mdPage("The $'s value", "# The $'s value\n\nBody."),
        '/money': mdPage('Costs $$5', '# Costs $$5\n\nCheap.'),
        '/nav': mdPage('Docs', '## Docs navigation\n\n- [a](/a)\n\n# Docs\n\nThe docs.'),
      })[path]!,
  )
  const text = await (
    await createLlmsFullHandler({ pages: () => ['/dollar', '/money', '/nav'] })(
      new Request(`${site}/llms-full.txt`),
    )
  ).text()
  expect(text).toBe(
    [
      `# The $'s value (${site}/dollar)\n\nBody.`,
      `# Costs $$5 (${site}/money)\n\nCheap.`,
      `## Docs navigation\n\n- [a](/a)\n\n# Docs (${site}/nav)\n\nThe docs.\n`,
    ].join('\n\n'),
  )
})

test('llms has a deadline for the whole file: a page not rendered by then failed', async () => {
  llmsPages(async (path, signal) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 40)
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(signal.reason)
      })
    })
    return mdPage(`Page ${path}`, `# Page ${path}\n\nBody.`)
  })
  const paths = ['/a', '/b', '/c', '/d', '/e', '/f']
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const index = await createLlmsTxtHandler({
    concurrency: 1,
    deadline: 100,
    sections: () => [{ title: 'All', pages: paths }],
  })(new Request(`${site}/llms.txt`))
  const text = await index.text()
  const rendered = paths.filter((path) => text.includes(`[Page ${path}]`))
  expect(rendered.length).toBeGreaterThan(0)
  expect(rendered.length).toBeLessThan(paths.length)
  const failed = String(paths.length - rendered.length)
  expect(index.headers.get('x-affordances-md-dropped')).toBe(failed)
  expect(String(warn.mock.calls[0]?.[0])).toContain(
    "(not rendered within the file's 100ms deadline)",
  )
  const full = await createLlmsFullHandler({ pages: () => paths, concurrency: 1, deadline: 100 })(
    new Request(`${site}/llms-full.txt`),
  )
  // its own run, timed on its own: a 503 counting what it couldn't render, whatever that came to
  expect(full.status).toBe(503)
  expect(Number(full.headers.get('x-affordances-md-dropped'))).toBeGreaterThan(0)
  warn.mockRestore()
  expect(() => createLlmsFullHandler({ deadline: 0 })).toThrow(
    '[affordances-md] deadline is how long the whole file may take, in milliseconds above 0; got 0',
  )
})

test('llms.txt names each page as llms-full.txt heads it: a layout title other pages share gives way to its heading', async () => {
  llmsPages(
    (path) =>
      ({
        '/a': mdPage('Bench', '# Alpha\n\nA.'),
        '/b': mdPage('Bench', '# Beta\n\nB.'),
        '/clean': mdPage('Clean install', '# npm is slowest\n\nBy 2×.'),
      })[path]!,
  )
  const paths = ['/a', '/b', '/clean']
  const index = await (
    await createLlmsTxtHandler({ title: 'Shop', sections: () => [{ title: 'All', pages: paths }] })(
      new Request(`${site}/llms.txt`),
    )
  ).text()
  const full = await (
    await createLlmsFullHandler({ pages: () => paths })(new Request(`${site}/llms-full.txt`))
  ).text()
  expect(index.match(/^- \[[^\]]+\]/gm)).toEqual(['- [Alpha]', '- [Beta]', '- [Clean install]'])
  expect(full.match(/^# .+(?= \()/gm)).toEqual(['# Alpha', '# Beta', '# Clean install'])
})

test('a heading names a page only when its title goes on past a separator and a space, not inside a word', async () => {
  llmsPages(
    (path) =>
      ({
        '/sign-in': mdPage('Sign-in · Acme', '# Sign\n\nIn.'),
        '/cart': mdPage('Cart · Acme', '# Cart\n\nEmpty.'),
        '/order': mdPage('Order: details', '# Order\n\nShipped.'),
      })[path]!,
  )
  const paths = ['/sign-in', '/cart', '/order']
  const index = await (
    await createLlmsTxtHandler({ sections: () => [{ title: 'All', pages: paths }] })(
      new Request(`${site}/llms.txt`),
    )
  ).text()
  expect(index.match(/^- \[[^\]]+\]/gm)).toEqual(['- [Sign-in · Acme]', '- [Cart]', '- [Order]'])
})

test("llms-full heads each page with its title, unless that's its heading's start or not the page's own", async () => {
  llmsPages(
    (path) =>
      ({
        // a title that isn't the page's first heading, which is a finding
        '/clean': mdPage('Clean install · Bench', '# npm is slowest\n\nBy 2×.'),
        // the usual title: its heading, then the site's name
        '/cart': mdPage('Cart · Bench', '# Cart\n\nEmpty.'),
        // a layout's title, on every page: their headings head them
        '/a': mdPage('Bench', '# Alpha\n\nA.'),
        '/b': mdPage('Bench', '# Beta\n\nB.'),
        // no heading of its own
        '/bare': mdPage('Bare page', 'Just text.'),
      })[path]!,
  )
  const index = { name: 'Bench', routes: [] }
  const appFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url: URL, init: RequestInit) =>
    new URL(url).pathname === '/.well-known/affordances.json'
      ? Promise.resolve(Response.json(index))
      : appFetch(url, init),
  )
  const text = await (
    await createLlmsFullHandler({ pages: () => ['/clean', '/cart', '/a', '/b', '/bare'] })(
      new Request(`${site}/llms-full.txt`),
    )
  ).text()
  expect(text).toBe(
    [
      `# Clean install (${site}/clean)\n\n# npm is slowest\n\nBy 2×.`,
      `# Cart (${site}/cart)\n\nEmpty.`,
      `# Alpha (${site}/a)\n\nA.`,
      `# Beta (${site}/b)\n\nB.`,
      `# Bare page (${site}/bare)\n\nJust text.\n`,
    ].join('\n\n'),
  )
})

// next's whole route pipeline, as next build runs it: each rewrite checked, prefixed with basePath and i18n's locales,
// and checked again (lib/load-custom-routes.js); it exits the process on one it rejects
const { default: loadCustomRoutes } = createRequire(import.meta.url)(
  'next/dist/lib/load-custom-routes.js',
) as {
  default: (config: object) => Promise<{ rewrites: { beforeFiles: Rewrite[] }; headers: Header[] }>
}
const nextLoads = async (config: object) => {
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`next rejected the routes (exit ${code})`)
  })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return await loadCustomRoutes({ trailingSlash: false, ...config })
  } finally {
    exit.mockRestore()
    error.mockRestore()
    warn.mockRestore()
  }
}

test('md() finds the route handlers in app/ outside api/, next metadata routes among them', () => {
  const project = app([
    'app/page.tsx',
    'app/llms.txt/route.ts',
    'app/(meta)/og/[slug]/route.tsx',
    'app/api/cart/route.ts',
    'app/sitemap.ts',
    'app/robots.ts',
    'app/manifest.ts',
    'app/icon.tsx',
    'app/blog/[slug]/page.tsx',
    'app/blog/[slug]/opengraph-image.tsx',
  ])
  const found = [
    '/blog/[slug]/opengraph-image',
    '/icon',
    '/llms.txt',
    '/manifest.webmanifest',
    '/og/[slug]',
    '/robots.txt',
    '/sitemap.xml',
  ]
  expect(scanApp(project).handlers).toEqual(found)
  const config: Config = md({ root: project })({})
  expect(config.env?.[HANDLERS_ENV]).toBe(JSON.stringify(found))
  const plain: Config = md({ root: app(['app/page.tsx']) })({})
  expect(plain.env).not.toHaveProperty(HANDLERS_ENV)
})

test('no app is too big for its config: the Accept rule is one rule, whatever its route handlers or basePath', async () => {
  const many = Array.from({ length: 1000 }, (_, i) =>
    i % 2 ? `/feeds/feed-${i}.xml` : `/og-${i}/[slug]`,
  )
  const project = app(['app/page.tsx', ...many.map((route) => `app${route}/route.ts`)])
  // typed as an app's next.config is
  for (const extra of [{}, { basePath: '/docs' }] as NextConfig[]) {
    const config: Config = md({ root: project })(extra)
    const { beforeFiles } = (await config.rewrites!()) as { beforeFiles: Rewrite[] }
    expect(beforeFiles).toEqual(rewrites.beforeFiles)
    const loaded = await nextLoads({ ...config, ...extra })
    expect(loaded.rewrites.beforeFiles.length).toBeGreaterThan(0)
  }
})

// the app's markdown route for a url asked for with Accept, given its pages and route handlers
const routedWith = (routes: string[], handlers: string[]) => {
  vi.stubEnv(ROUTES_ENV, JSON.stringify(routes))
  vi.stubEnv(HANDLERS_ENV, JSON.stringify(handlers))
}

test("a route handler next routes a url to is passed through as it is, with the caller's own headers", async () => {
  routedWith(['/', '/[slug]'], ['/llms.txt'])
  upstream = () =>
    new Response('# llms', { headers: { 'content-type': 'text/plain', etag: '"1"' } })
  const response = await createMdHandler({ headers: { authorization: 'Bearer service' } })(
    new Request(`${site}/llms.txt`, {
      headers: { accept: 'text/markdown', 'if-none-match': '"0"' },
    }),
  )
  expect([response.status, response.headers.get('content-type'), await response.text()]).toEqual([
    200,
    'text/plain',
    '# llms',
  ])
  // fetched as the page itself: the caller's accept and conditional headers, never the service's credentials
  const [call] = seen
  expect([
    call!.headers.get('accept'),
    call!.headers.get('if-none-match'),
    call!.headers.get('authorization'),
  ]).toEqual(['text/markdown', '"0"', null])
  vi.unstubAllEnvs()
})

test('a root catch-all route handler leaves every page its markdown and its twin, and /og/about beats /og/[slug]', async () => {
  routedWith(['/', '/about', '/og/about'], ['/[...slug]', '/og/[slug]'])
  const accept = (path: string) =>
    isMdRequest(new Request(`${site}${path}`, { headers: { accept: 'text/markdown' } }))
  expect(['/about', '/og/about', '/og/x', '/anything/else'].map(accept)).toEqual([
    true,
    true,
    true,
    true,
  ])
  expect(['/about', '/og/about', '/og/x', '/anything/else'].map(hasTwin)).toEqual([
    true,
    true,
    false,
    false,
  ])
  // the static page converts; the handler a url routes to is passed through
  upstream = (url) =>
    url.pathname === '/og/about'
      ? new Response(page('<h1>About og</h1>'), { headers: { 'content-type': 'text/html' } })
      : new Response('svg', { headers: { 'content-type': 'image/svg+xml' } })
  const about = await handler(
    new Request(`${site}/og/about`, { headers: { accept: 'text/markdown' } }),
  )
  expect(await about.text()).toContain('# About og')
  const og = await handler(new Request(`${site}/og/x`, { headers: { accept: 'text/markdown' } }))
  expect([og.headers.get('content-type'), await og.text()]).toEqual(['image/svg+xml', 'svg'])
  vi.unstubAllEnvs()
})

test("a root catch-all twins pages, never public/'s files or next's metadata routes, and keeps their Link off", async () => {
  const images = Array.from({ length: 3000 }, (_, i) => `public/images/${i}.png`)
  const project = app([
    'app/page.tsx',
    'app/[...slug]/page.tsx',
    'app/sitemap.ts',
    'app/robots.ts',
    'app/manifest.ts',
    'app/opengraph-image.tsx',
    'app/llms.txt/route.ts',
    'public/openapi.json',
    'public/spec/v 1.yaml',
    // a folder named like the pages under it, as a docs site's images often are
    'public/docs/logo.png',
    ...images,
  ])
  // a folder linked in, as a monorepo's shared assets are
  mkdirSync(join(project, 'shared/fonts'), { recursive: true })
  writeFileSync(join(project, 'shared/fonts/inter.woff2'), '')
  symlinkSync(join(project, 'shared/fonts'), join(project, 'public/fonts'))
  const config: Config = md({ root: project })({})
  // thousands of images are one entry, with the extensions in it; names as a request asks for them
  const listed = JSON.parse(config.env![PUBLIC_ENV]!) as string[]
  expect(listed).toEqual([
    '/docs/logo.png',
    '/fonts/inter.woff2',
    '/images/*.png',
    '/openapi.json',
    '/spec/v%201.yaml',
  ])
  for (const name of [ROUTES_ENV, HANDLERS_ENV, PUBLIC_ENV]) vi.stubEnv(name, config.env![name]!)
  const none = [
    '/openapi.json',
    '/spec/v%201.yaml',
    '/images/12.png',
    '/docs/logo.png',
    '/fonts/inter.woff2',
    '/sitemap.xml',
    '/robots.txt',
    '/manifest.webmanifest',
    '/opengraph-image',
    '/llms.txt',
  ]
  expect(none.filter(hasTwin)).toEqual([])
  // pages under a public/ folder's name keep theirs: /docs/intro beside public/docs/, and under the folded images
  // folder, any name that isn't one of its files' kinds (/images/gallery, /images/v1.2)
  const kept = [
    '/',
    '/guide/intro',
    '/openapi',
    '/images',
    '/docs/intro',
    '/images/gallery',
    '/images/v1.2',
  ]
  expect(kept.filter(hasTwin)).toEqual(kept)
  // a page's links: its own kept go to their twins, the rest stay as they are
  upstream = () =>
    new Response(
      page(
        `<h1>Guide</h1><p>${[...none, '/guide/next'].map((href) => `<a href="${href}">${href}</a>`).join(' ')}</p>`,
      ),
      { headers: { 'content-type': 'text/html' } },
    )
  const markdown = await (await createMdHandler()(new Request(`${site}/guide/intro.md`))).text()
  expect(markdown).toContain(`[/guide/next](${site}/guide/next.md)`)
  for (const href of none) expect(markdown).toContain(`(${site}${href})`)
  // and a path has a Link exactly when it has a twin, in rules next loads
  const rules = await config.headers!()
  for (const path of [...none.slice(0, 5), ...kept.slice(1)])
    expect([path, Boolean(linkOn(rules, path))]).toEqual([path, hasTwin(path)])
  expect(linkOn(rules, '/guide/intro')).toBe(alternate('/guide/intro.md'))
  expect(linkOn(rules, '/openapi')).toBe(alternate('/openapi.md'))
  expect(linkOn(rules, '/docs/intro')).toBe(alternate('/docs/intro.md'))
  expect(linkOn(rules, '/images/gallery')).toBe(alternate('/images/gallery.md'))
  expect((await nextLoads(config)).headers.length).toBeGreaterThan(0)
  vi.unstubAllEnvs()
})

test('a route handler never gets a twin, a page link or an intro link alike, even beside a root dynamic page', () => {
  routedWith(['/[slug]'], ['/llms-full.txt', '/og/[slug]'])
  expect(['/about', '/llms-full.txt', '/og/x', '/og'].map(hasTwin)).toEqual([
    true,
    false,
    false,
    true,
  ])
  vi.unstubAllEnvs()
})
