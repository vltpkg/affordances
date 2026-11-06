import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
  mdPagePath,
  mdRewrite,
  RENDER_HEADER,
  type Rewrite,
  rewrites,
  withMd,
} from '../src/next/index.ts'
import { ROUTES_ENV } from '../src/next/routes.ts'

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
  expect((await small(new Request(`${site}/api/affordances/md/a`))).status).toBe(413)
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
const nextRewrites = (pathname: string, headers: Record<string, string>) =>
  ([...rewrites.beforeFiles, ...rewrites.afterFiles] as Rewrite[]).some(
    (rule) =>
      getPathMatch(rule.source)(pathname) &&
      matchHas({ headers }, {}, rule.has, rule.missing) !== false,
  )

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

test('the uppercase .MD next rewrites still finds the page', async () => {
  await handler(new Request(`${site}/pricing.MD`))
  expect(seen[0]!.url.pathname).toBe('/pricing')
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
  expect(seen.length).toBeGreaterThan(1)
  expect(seen.every((call) => call.headers.get('x-vercel-protection-bypass') === 's3cret')).toBe(
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
      `Every page is also Markdown: add \`.md\` to its URL, or request it with \`Accept: text/markdown\`. [llms-full.txt](${site}/llms-full.txt) has every page in one file.`,
      `This site is Affordances-enabled: request any page with \`Accept: application/vnd.affordances+json\` for its graph (what the page shows, and the actions you can call there, with their inputs). [/.well-known/affordances.json](${site}/.well-known/affordances.json) lists every route and its actions.`,
      `## Pages\n\n- [Home](${site}/index.md): Every product, with its price\n- [Cart](${site}/cart.md): What is in the cart`,
    ].join('\n\n') + '\n',
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
