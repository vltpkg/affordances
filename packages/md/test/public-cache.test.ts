import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CACHE_LIFE_ENV, cacheControlFor, PROFILES } from '../src/next/cache.ts'
import { type Config, createMdHandler, md } from '../src/next/index.ts'
import { ROUTES_ENV } from '../src/next/routes.ts'
import { routes as authored } from './markdown-routes.ts'

// next's own getCacheControlHeader (server/lib/cache-control.js), from the copy of next this repo installs
const { getCacheControlHeader } = createRequire(import.meta.url)(
  'next/dist/server/lib/cache-control.js',
) as { getCacheControlHeader: (cache: { revalidate: number | false; expire?: number }) => string }

// next 16.3.0 and 16.4.3 build a cached page's Cache-Control the same way: server/config-shared.js gives the
// profiles and expireTime (31536000); app-render.js takes revalidate >= INFINITE_CACHE as false and such an expire as
// undefined; base-server.js gives a page with no expire expireTime; server/lib/cache-control.js writes the header.
// the table is what that gives for each profile, as a page cached with cacheLife(profile) gets it
test("publicCache's Cache-Control is what next sends for a page cached with that cacheLife", () => {
  const table: [string, string][] = [
    ['default', 's-maxage=900, stale-while-revalidate=31535100'],
    ['seconds', 's-maxage=1, stale-while-revalidate=59'],
    ['minutes', 's-maxage=60, stale-while-revalidate=3540'],
    ['hours', 's-maxage=3600, stale-while-revalidate=82800'],
    ['days', 's-maxage=86400, stale-while-revalidate=518400'],
    ['weeks', 's-maxage=604800, stale-while-revalidate=1987200'],
    ['max', 's-maxage=2592000, stale-while-revalidate=28944000'],
  ]
  expect(table.map(([name]) => name)).toEqual(Object.keys(PROFILES))
  // ours, and next's own function, given the page's cache control as app-render.js and base-server.js make it
  const next = (name: string) => {
    const { revalidate, expire } = PROFILES[name]!
    return getCacheControlHeader({
      revalidate: revalidate!,
      expire: expire! >= 0xfffffffe ? 31_536_000 : expire,
    })
  }
  const expected = Object.fromEntries(table)
  expect(
    Object.fromEntries(table.map(([name]) => [name, cacheControlFor(PROFILES[name]!, 31_536_000)])),
  ).toEqual(expected)
  expect(Object.fromEntries(table.map(([name]) => [name, next(name)]))).toEqual(expected)
  // seconds of its own, with no expire: expireTime's, as a page with revalidate = 300 gets
  expect(cacheControlFor({ revalidate: 300 }, 31_536_000)).toBe(
    's-maxage=300, stale-while-revalidate=31535700',
  )
  expect(getCacheControlHeader({ revalidate: 300, expire: 31_536_000 })).toBe(
    's-maxage=300, stale-while-revalidate=31535700',
  )
  // never revalidating (Infinity, as next normalizes it): a year
  expect(cacheControlFor({ revalidate: 0xfffffffe }, 31_536_000)).toBe('s-maxage=31536000')
  expect(getCacheControlHeader({ revalidate: false, expire: 31_536_000 })).toBe('s-maxage=31536000')
  // an expireTime of the app's own, and none (NEXT_PRIVATE_CDN_CONSUMED_SWR_CACHE_CONTROL)
  expect(cacheControlFor({ revalidate: 60 }, 600)).toBe('s-maxage=60, stale-while-revalidate=540')
  expect(cacheControlFor({ revalidate: 60 }, undefined)).toBe('s-maxage=60')
  // revalidate 0 is next's dynamic page
  expect(cacheControlFor({ revalidate: 0, expire: 60 }, 31_536_000)).toBe(
    'private, no-cache, no-store, max-age=0, must-revalidate',
  )
})

const site = 'https://shop.test'
const ROUTE = '/x/[pkg]'
const page = (body: string) =>
  `<html><head><title>Express</title></head><body><main>${body}</main></body></html>`
const slot = (name: string) =>
  `<affordances-md data-mode="slot" data-name="${name}" style="display:contents"><p>Loading…</p></affordances-md>`

// the page's own response, as next sends a dynamic render
let upstream: (url: URL, init?: RequestInit) => Response
beforeEach(() => {
  upstream = () =>
    new Response(page(`<h1>express</h1>${slot('readme')}`), {
      headers: {
        'content-type': 'text/html',
        'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate',
      },
    })
  vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => upstream(new URL(url), init))
  process.env[ROUTES_ENV] = JSON.stringify([ROUTE])
})
afterEach(() => {
  for (const route of Object.keys(authored)) delete authored[route]
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete process.env[ROUTES_ENV]
  delete process.env[CACHE_LIFE_ENV]
})

// the three kinds of route, each with or without the opt-in
const kinds = {
  slot: { slots: { readme: () => '## Readme\n\nFast.' } },
  default: { default: () => '# express\n\nFast.' },
  converted: {},
} as const
const route = (kind: keyof typeof kinds, publicCache?: unknown) => {
  authored[ROUTE] = async () =>
    ({ ...kinds[kind], ...(publicCache !== undefined && { publicCache }) }) as never
}

test('publicCache makes one cell public: opted in, no credentials, the .md url, complete, no cookie set', async () => {
  const cells: string[] = []
  const statuses = new Set<number>()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  for (const kind of ['slot', 'default', 'converted'] as const)
    for (const opted of [true, false])
      for (const credentials of ['none', 'cookie', 'authorization', 'service'] as const)
        for (const url of ['twin', 'negotiated'] as const)
          for (const partial of [false, true])
            for (const setCookie of [false, true]) {
              // a default export renders nothing, so it has no partial page or cookie of its own
              if (kind === 'default' && (partial || setCookie)) continue
              route(kind, opted ? 'hours' : undefined)
              upstream = () =>
                new Response(
                  partial
                    ? new ReadableStream({
                        start: (controller) =>
                          controller.enqueue(
                            new TextEncoder().encode(page(`<h1>express</h1>${slot('readme')}`)),
                          ),
                      })
                    : page(`<h1>express</h1>${slot('readme')}`),
                  {
                    headers: {
                      'content-type': 'text/html',
                      'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate',
                      ...(setCookie && { 'set-cookie': 'handshake=1; Path=/' }),
                    },
                  },
                )
              const handler = createMdHandler({
                timeout: partial ? 30 : 10_000,
                ...(credentials === 'service' && { headers: { authorization: 'Bearer service' } }),
              })
              const headers = {
                ...(credentials === 'cookie' && { cookie: 'sid=1' }),
                ...(credentials === 'authorization' && { authorization: 'Bearer person' }),
                ...(url === 'negotiated' && { accept: 'text/markdown' }),
              }
              const response = await handler(
                new Request(`${site}${url === 'twin' ? '/x/express.md' : '/x/express'}`, {
                  headers,
                }),
              )
              const cache = response.headers.get('cache-control') ?? ''
              statuses.add(response.status)
              if (!/private/.test(cache))
                cells.push(
                  `${kind} opted=${opted} ${credentials} ${url} partial=${partial} set-cookie=${setCookie}: ${cache}`,
                )
            }
  warn.mockRestore()
  // an anonymous request for the page's own url, on an opted-in route, is sent to its twin
  expect([...statuses].toSorted()).toEqual([200, 307])
  expect(cells).toEqual([
    'slot opted=true none twin partial=false set-cookie=false: s-maxage=3600, stale-while-revalidate=82800',
    'default opted=true none twin partial=false set-cookie=false: s-maxage=3600, stale-while-revalidate=82800',
    'converted opted=true none twin partial=false set-cookie=false: s-maxage=3600, stale-while-revalidate=82800',
  ])
})

// a response's headers but its cache-control
const without = (response: Response) =>
  [...response.headers].filter(([name]) => name !== 'cache-control')

test('a credentialed request to an opted-in route stays private and personal, as it is today', async () => {
  route('slot', 'hours')
  const signedIn = await createMdHandler()(
    new Request(`${site}/x/express.md`, { headers: { cookie: 'sid=1' } }),
  )
  expect([
    signedIn.headers.get('cache-control'),
    signedIn.headers.get('x-affordances-md-personal'),
  ]).toEqual(['private, no-store', '1'])
  // and an opted-in route answers exactly as before with no publicCache: the same headers, the same body
  const opted = await createMdHandler()(new Request(`${site}/x/express.md`))
  route('slot')
  const plain = await createMdHandler()(new Request(`${site}/x/express.md`))
  expect(await opted.text()).toBe(await plain.text())
  expect(without(opted)).toEqual(without(plain))
})

test('a Response a default export returns keeps its own rule, opted in or not', async () => {
  authored[ROUTE] = async () =>
    ({
      default: () => new Response('# Mine', { headers: { 'cache-control': 'public, max-age=60' } }),
      publicCache: 'days',
    }) as never
  const response = await createMdHandler()(new Request(`${site}/x/express.md`))
  expect(response.headers.get('cache-control')).toBe('public, max-age=60')
})

test('a page that sets a cookie for an anonymous visitor stays private on an opted-in route, said in development', async () => {
  route('converted', 'hours')
  upstream = () =>
    new Response(page('<h1>express</h1>'), {
      headers: { 'content-type': 'text/html', 'set-cookie': '__clerk_handshake=x; Path=/' },
    })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const response = await createMdHandler()(new Request(`${site}/x/express.md`))
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(warn).toHaveBeenCalledWith(
    "[affordances-md] /x/express set a cookie (__clerk_handshake) for an anonymous visitor, so /x/[pkg]/markdown.ts's publicCache doesn't apply: its markdown is private, no-store. Don't set it on this page for a visitor who isn't signed in.",
  )
  warn.mockClear()
  vi.stubEnv('NODE_ENV', 'production')
  await createMdHandler()(new Request(`${site}/x/express.md`))
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

// the cache-control a default export's route gets with this publicCache
const header = async (publicCache: unknown) => {
  route('default', publicCache)
  return (await createMdHandler()(new Request(`${site}/x/express.md`))).headers.get('cache-control')
}

test("a custom cacheLife profile works by name; one that isn't a profile stays private, said once in development", async () => {
  const config: Config = md({ root: '/nonexistent' })({
    cacheLife: { packages: { revalidate: 600, expire: 3600 }, forever: { revalidate: Infinity } },
    expireTime: 7200,
  })
  expect(JSON.parse(config.env![CACHE_LIFE_ENV]!)).toEqual({
    profiles: {
      packages: { revalidate: 600, expire: 3600 },
      forever: { revalidate: 0xfffffffe },
    },
    expireTime: 7200,
  })
  process.env[CACHE_LIFE_ENV] = config.env![CACHE_LIFE_ENV]
  expect(await header('packages')).toBe('s-maxage=600, stale-while-revalidate=3000')
  // a profile with no expire, and seconds with none: the app's expireTime
  expect(await header('forever')).toBe('s-maxage=31536000')
  expect(await header({ revalidate: 60 })).toBe('s-maxage=60, stale-while-revalidate=7140')
  // next's own still there
  expect(await header('hours')).toBe('s-maxage=3600, stale-while-revalidate=82800')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await header('hourz')).toBe('private, no-store')
  expect(await header('hourz')).toBe('private, no-store')
  expect(error.mock.calls.map(([message]) => message)).toEqual([
    "[affordances-md] /x/[pkg]/markdown.ts: publicCache 'hourz' isn't a cacheLife profile. It can be one of Next's cacheLife profiles ('default', 'seconds', 'minutes', 'hours', 'days', 'weeks', 'max', 'packages', 'forever') or { revalidate, expire? } in seconds; until then, it isn't cached.",
  ])
  error.mockClear()
  for (const [value, problem] of [
    [{ revalidat: 300 }, "has revalidat, which isn't revalidate or expire"],
    [{ expire: 300 }, 'needs revalidate, in seconds'],
    [{ revalidate: 300, expire: 60 }, 'has an expire shorter than its revalidate'],
    [300, "isn't a cacheLife profile or { revalidate, expire? }"],
  ] as const) {
    route('slot', value)
    // a route says it once per process, so a fresh route each time
    const at = `/y${problem.length}/[pkg]`
    authored[at] = authored[ROUTE]!
    process.env[ROUTES_ENV] = JSON.stringify([ROUTE, at])
    const response = await createMdHandler()(
      new Request(`${site}${at.replace('[pkg]', 'express')}.md`),
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(String(error.mock.calls.at(-1)?.[0])).toContain(`: publicCache ${problem}.`)
  }
  error.mockRestore()
})

// a twin's markdown, asked for with these headers
const twin = async (headers: Record<string, string>, url = '/x/express.md') =>
  (await createMdHandler()(new Request(`${site}${url}`, { headers }))).text()

test("an opted-in route's public view is one language: rendered, and its markdown.ts run, without Accept-Language", async () => {
  // a page that renders in the language it's asked for, and a default export that reads it
  upstream = (_url, init) =>
    new Response(
      page(
        `<h1>express</h1><p>LANG-${new Headers(init?.headers).get('accept-language') ?? 'none'}</p>`,
      ),
      {
        headers: { 'content-type': 'text/html' },
      },
    )
  route('converted', 'hours')
  const fr = await twin({ 'accept-language': 'fr' })
  expect(fr).toContain('LANG-none')
  expect(await twin({ 'accept-language': 'de' })).toBe(fr)
  authored[ROUTE] = async () =>
    ({
      default: ({ request }: { request: Request }) =>
        `# express\n\nlang=${request.headers.get('accept-language') ?? 'none'}`,
      publicCache: 'hours',
    }) as never
  expect(await twin({ 'accept-language': 'fr' })).toContain('lang=none')
  // a view that stays private keeps it: signed in, or a route that didn't opt in. one asked for with Accept is sent
  // to the twin
  expect(await twin({ 'accept-language': 'fr', cookie: 'sid=1' })).toContain('lang=fr')
  expect(
    await twin({ 'accept-language': 'fr', accept: 'text/markdown', cookie: 'sid=1' }, '/x/express'),
  ).toContain('lang=fr')
  route('converted')
  expect(await twin({ 'accept-language': 'fr' })).toContain('LANG-fr')
})

test('an opted-in route whose page varies on Accept-Language says, once in development, that its public markdown is the default language', async () => {
  upstream = () =>
    new Response(page('<h1>express</h1>'), {
      headers: { 'content-type': 'text/html', vary: 'Accept-Language' },
    })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  route('converted', 'hours')
  await twin({ 'accept-language': 'fr' })
  await twin({ 'accept-language': 'de' })
  expect(warn.mock.calls.map(([message]) => message)).toEqual([
    "[affordances-md] /x/[pkg]'s page varies on Accept-Language, but /x/[pkg]/markdown.ts's publicCache makes its markdown one view for everyone: it's rendered without the visitor's language, so it's the default language. For Markdown in each language, put the locale in the path (/fr/…).",
  ])
  // not for a route that didn't opt in, nor in production
  warn.mockClear()
  route('converted')
  await twin({})
  vi.stubEnv('NODE_ENV', 'production')
  route('slot', 'hours')
  await twin({})
  expect(warn).not.toHaveBeenCalled()
  warn.mockRestore()
})

test('the one public view is the same request everywhere: no language for append, the headers option or a fill, which still gets a NextRequest', async () => {
  upstream = () =>
    new Response(page(`<h1>express</h1>${slot('readme')}`), {
      headers: { 'content-type': 'text/html', vary: 'Accept-Language' },
    })
  const seenBy: Record<string, string | null> = {}
  let calls = 0
  const handler = createMdHandler({
    append: (request) => {
      seenBy.append = request.headers.get('accept-language')
      return undefined
    },
    headers: (request) => {
      calls++
      seenBy.headers = request.headers.get('accept-language')
      return {}
    },
  })
  authored[ROUTE] = async () =>
    ({
      slots: {
        readme: ({ request }: { request: NextRequest }) => {
          seenBy.fill = request.headers.get('accept-language')
          return `## Readme\n\nat ${request.nextUrl.pathname}`
        },
      },
      publicCache: 'hours',
    }) as never
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const response = await handler(
    new NextRequest(`${site}/x/express.md`, { headers: { 'accept-language': 'fr' } }),
  )
  warn.mockRestore()
  expect(await response.text()).toContain('at /x/express.md')
  expect(seenBy).toEqual({ headers: null, fill: null, append: null })
  // the headers option, once: one answer for whether it's public and for the render
  expect(calls).toBe(1)
  // and a public response varies only on Accept, since the language never reached it
  expect([response.headers.get('cache-control'), response.headers.get('vary')]).toEqual([
    's-maxage=3600, stale-while-revalidate=82800',
    'Accept',
  ])
  // a private one keeps the language, and says so
  const signedIn = await handler(
    new NextRequest(`${site}/x/express.md`, {
      headers: { 'accept-language': 'fr', cookie: 'sid=1' },
    }),
  )
  expect([signedIn.headers.get('vary'), seenBy.fill]).toEqual(['Accept, Accept-Language', 'fr'])
})

test('experimental.cacheLife is read too, and replaces the top-level one, as next does', async () => {
  const both: Config = md({ root: '/nonexistent' })({
    cacheLife: { packages: { revalidate: 60 } },
    experimental: { cacheLife: { packages: { revalidate: 600, expire: 3600 } } },
  })
  expect(JSON.parse(both.env![CACHE_LIFE_ENV]!).profiles).toEqual({
    packages: { revalidate: 600, expire: 3600 },
  })
  const only: Config = md({ root: '/nonexistent' })({
    experimental: { cacheLife: { legacy: { revalidate: 120, expire: 240 } } },
  })
  process.env[CACHE_LIFE_ENV] = only.env![CACHE_LIFE_ENV]
  expect(await header('legacy')).toBe('s-maxage=120, stale-while-revalidate=120')
})

test('a fill on the one public view gets a NextRequest from any request: nextUrl and cookies, as in a built app', async () => {
  upstream = () =>
    new Response(page(`<h1>express</h1>${slot('readme')}`), {
      headers: { 'content-type': 'text/html' },
    })
  authored[ROUTE] = async () =>
    ({
      slots: {
        readme: ({ request }: { request: NextRequest }) =>
          `## Readme\n\nNU-${request.nextUrl?.pathname ?? 'missing'} cookies=${typeof request.cookies?.get}`,
      },
      publicCache: 'hours',
    }) as never
  // a plain Request, as md sees next's own in a built app, where its NextRequest is another copy of the class
  const response = await createMdHandler()(
    new Request(`${site}/x/express.md`, { headers: { 'accept-language': 'fr' } }),
  )
  expect(await response.text()).toContain('NU-/x/express.md cookies=function')
})

test("the one public view carries none of the visitor's headers: no user agent or country reaches a fill", async () => {
  upstream = () =>
    new Response(page(`<h1>express</h1>${slot('readme')}`), {
      headers: { 'content-type': 'text/html' },
    })
  authored[ROUTE] = async () =>
    ({
      slots: {
        readme: ({ request }: { request: Request }) =>
          `## Readme\n\nua=${request.headers.get('user-agent') ?? 'none'} country=${request.headers.get('cf-ipcountry') ?? 'none'}`,
      },
      publicCache: 'hours',
    }) as never
  const visitor = { 'user-agent': 'agent/1', 'cf-ipcountry': 'FR', 'x-vercel-ip-country': 'FR' }
  const anonymous = await createMdHandler()(
    new Request(`${site}/x/express.md`, { headers: visitor }),
  )
  expect(await anonymous.text()).toContain('ua=none country=none')
  expect(anonymous.headers.get('cache-control')).toBe('s-maxage=3600, stale-while-revalidate=82800')
  // a signed-in request is the visitor's own, and stays private
  const signedIn = await createMdHandler()(
    new Request(`${site}/x/express.md`, { headers: { ...visitor, cookie: 'sid=1' } }),
  )
  expect(await signedIn.text()).toContain('ua=agent/1 country=FR')
  expect(signedIn.headers.get('cache-control')).toBe('private, no-store')
})

// a page whose boundary caught an error (error.tsx), as next start sent it: 200, with the error as a flight error row
// whose digest is a number, and the boundary's fallback in the html
const errored = (version: string) =>
  readFileSync(
    new URL(`./fixtures/streamed-error-boundary-next${version}.html`, import.meta.url),
    'utf8',
  )
const flight = (text: string) => `<script>self.__next_f.push(${JSON.stringify([1, text])})</script>`

test('a page with a flight error row is never public, on an opted-in route or off one, and says so', async () => {
  for (const version of ['16.3', '16.4'])
    for (const opted of [true, false]) {
      route('converted', opted ? 'hours' : undefined)
      // next's own cache-control, as a static page has it, isn't passed on either
      upstream = () =>
        new Response(errored(version), {
          headers: { 'content-type': 'text/html', 'cache-control': 's-maxage=31536000' },
        })
      const response = await createMdHandler()(new Request(`${site}/x/express.md`))
      expect([version, opted, response.status, response.headers.get('cache-control')]).toEqual([
        version,
        opted,
        200,
        'private, no-store',
      ])
      expect(response.headers.get('x-affordances-md-error')).toBe('1')
    }
  // a page without one, opted in, is still public
  route('converted', 'hours')
  upstream = () =>
    new Response(page('<h1>express</h1>'), { headers: { 'content-type': 'text/html' } })
  const fine = await createMdHandler()(new Request(`${site}/x/express.md`))
  expect(fine.headers.get('cache-control')).toBe('s-maxage=3600, stale-while-revalidate=82800')
  expect(fine.headers.has('x-affordances-md-error')).toBe(false)
})

test("any error row counts, whatever it holds; a next digest md can't read is said once per process", async () => {
  route('converted', 'hours')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('NODE_ENV', 'production')
  const rows = [
    '5:E{"digest":"1234567"}\n',
    '5:E{"message":"no digest in development"}\n',
    '5:E{not json\n',
    '5:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;418"}\n',
    '5:E{"digest":"NEXT_SOMETHING_NEW;x"}\n',
  ]
  for (const row of rows) {
    upstream = () =>
      new Response(page('<h1>express</h1>') + flight(row), {
        headers: { 'content-type': 'text/html' },
      })
    const response = await createMdHandler()(new Request(`${site}/x/express.md`))
    // a next digest md can't read may be a redirect or a status it can't tell, and a row that isn't json can't be read
    // at all: never a 200 of the shell
    const status = row.includes('NEXT_') || row.includes('not json') ? 502 : 200
    // and its body is md's own, never the shell's markdown
    const shell = (await response.text()).includes('express')
    expect([row, response.status, response.headers.get('cache-control'), shell]).toEqual([
      row,
      status,
      'private, no-store',
      status === 200,
    ])
  }
  // flight data react couldn't read is a 502 too, with nothing of the page in it
  upstream = () =>
    new Response(
      `${page('<h1>express</h1>')}<script>self.__next_f.push([1,"x"]</script><script>self.__next_f.push(nope)</script>`,
      {
        headers: { 'content-type': 'text/html' },
      },
    )
  const unreadable = await createMdHandler()(new Request(`${site}/x/express.md`))
  expect([
    unreadable.status,
    unreadable.headers.get('cache-control'),
    (await unreadable.text()).includes('express'),
  ]).toEqual([502, 'private, no-store', false])
  // each once per process, in production too: the unreadable row, and the digest by its kind alone (the rest can hold
  // a url)
  expect(error.mock.calls.map(([message]) => message)).toEqual([
    expect.stringMatching(
      /^\[affordances-md\] \/x\/express's Flight data couldn't be read \((row|push)\), so it answers 502, private, no-store\./,
    ),
    "[affordances-md] a page streamed a Next.js digest @affordances/md doesn't know (NEXT_HTTP_ERROR_FALLBACK), so its markdown answers 502, private, no-store. Update @affordances/md, or report it if you're on the latest.",
  ])
  error.mockRestore()
})

// a boundary that renders in the browser by design, as next start sent it on 16.3 and 16.4: dynamic() with ssr: false,
// or useSearchParams() in a static page's <Suspense>. react writes <!--$!--> and a template (data-dgst
// BAILOUT_TO_CLIENT_SIDE_RENDERING on 16.3, empty on 16.4, as a real error's stripped digest is), or $RX in a dynamic
// render, and no flight error row, since a client component never runs in flight
test("a boundary that renders in the browser by design isn't an error: an opted-in twin stays public", async () => {
  route('converted', 'hours')
  for (const marker of [
    '<!--$!--><template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING"></template><p>Loading…</p><!--/$-->',
    '<!--$!--><template data-dgst=""></template><p>Loading…</p><!--/$-->',
    '<!--$?--><template id="B:0"></template><p>Loading…</p><!--/$--><script>$RX("B:0","BAILOUT_TO_CLIENT_SIDE_RENDERING")</script>',
  ]) {
    upstream = () =>
      new Response(page(`<h1>express</h1>${marker}`), { headers: { 'content-type': 'text/html' } })
    const response = await createMdHandler()(new Request(`${site}/x/express.md`))
    expect([
      marker,
      response.status,
      response.headers.get('cache-control'),
      response.headers.has('x-affordances-md-error'),
    ]).toEqual([marker, 200, 's-maxage=3600, stale-while-revalidate=82800', false])
  }
})

// the page as next sent it: a page, one that sets a cookie, a 404, one still streaming, one with a flight error row
const sent = {
  page: () => new Response(page('<h1>express</h1>'), { headers: { 'content-type': 'text/html' } }),
  cookie: () =>
    new Response(page('<h1>express</h1>'), {
      headers: { 'content-type': 'text/html', 'set-cookie': 'handshake=1' },
    }),
  gone: () =>
    new Response(page('<h1>Gone</h1>'), { status: 404, headers: { 'content-type': 'text/html' } }),
  streaming: () =>
    new Response(
      new ReadableStream({
        start: (controller) =>
          controller.enqueue(new TextEncoder().encode(page('<h1>express</h1>'))),
      }),
      { headers: { 'content-type': 'text/html' } },
    ),
  errored: () =>
    new Response(page('<h1>express</h1>') + flight('5:E{"digest":"1"}\n'), {
      headers: { 'content-type': 'text/html' },
    }),
}

test('a response on an opted-in route that stays private says why, in production too, from a fixed set', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const cases: [keyof typeof sent, unknown, RequestInit, Parameters<typeof createMdHandler>[0]][] =
    [
      ['page', 'hours', {}, {}],
      ['page', 'hours', { headers: { cookie: 'sid=1' } }, {}],
      ['page', 'hours', {}, { headers: { authorization: 'Bearer service' } }],
      ['cookie', 'hours', {}, {}],
      ['gone', 'hours', {}, {}],
      ['streaming', 'hours', {}, { timeout: 30 }],
      ['errored', 'hours', {}, {}],
      ['page', 'hourz', {}, {}],
      // a route that didn't opt in never says
      ['page', undefined, { headers: { cookie: 'sid=1' } }, {}],
    ]
  const reasons: (string | null)[] = []
  // one at a time: each sets the route and the page
  for (const [answer, cache, init, options] of cases) {
    route('converted', cache)
    upstream = sent[answer]
    const response = await createMdHandler(options)(new Request(`${site}/x/express.md`, init))
    reasons.push(response.headers.get('x-affordances-md-uncached'))
  }
  expect(reasons).toEqual([
    null,
    'credentials',
    'credentials',
    'set-cookie',
    'status',
    'partial',
    'error',
    'invalid',
    null,
  ])
  warn.mockRestore()
  error.mockRestore()
})

test('an anonymous Accept request on an opted-in route goes to its twin, never stored, with nothing rendered', async () => {
  route('slot', 'hours')
  let renders = 0
  upstream = () => {
    renders++
    return new Response(page('<h1>express</h1>'), { headers: { 'content-type': 'text/html' } })
  }
  const asked = await createMdHandler()(
    new Request(`${site}/x/express?tab=deps`, { headers: { accept: 'text/markdown' } }),
  )
  expect([
    asked.status,
    asked.headers.get('location'),
    asked.headers.get('cache-control'),
    asked.headers.get('vary'),
    await asked.text(),
    renders,
  ]).toEqual([
    307,
    // relative: request.url's host is next's own, never the public one
    '/x/express.md?tab=deps',
    'private, no-store',
    'Accept',
    `This page's Markdown is at [/x/express.md?tab=deps](/x/express.md?tab=deps).\n`,
    0,
  ])
  // unchanged: a credentialed one, and a route that didn't opt in, get their markdown at the page's url
  const signedIn = await createMdHandler()(
    new Request(`${site}/x/express`, { headers: { accept: 'text/markdown', cookie: 'sid=1' } }),
  )
  route('slot')
  const off = await createMdHandler()(
    new Request(`${site}/x/express`, { headers: { accept: 'text/markdown' } }),
  )
  expect([signedIn.status, off.status]).toEqual([200, 200])
  expect([signedIn.headers.get('cache-control'), off.headers.get('cache-control')]).toEqual([
    'private, no-store',
    'private, no-store',
  ])
})

// a page that called notFound(): before its shell went out (next's 404, its not-found.tsx), or after (a 200 with the
// error row)
const notFound = {
  unstreamed: () =>
    new Response(page('<h1>404</h1><p>This page could not be found.</p>'), {
      status: 404,
      headers: { 'content-type': 'text/html' },
    }),
  streamed: () =>
    new Response(
      page('<h1>express</h1><p>Loading…</p>') +
        flight('5:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}\n'),
      { headers: { 'content-type': 'text/html' } },
    ),
}

test("notFoundMarkdown is the route's 404 whenever its page called notFound(), streamed or not, never cached", async () => {
  const asked: Record<string, string | string[]>[] = []
  authored[ROUTE] = async () =>
    ({
      notFoundMarkdown: ({ params }: { params: Record<string, string> }) => {
        asked.push(params)
        return `# No package ${decodeURIComponent(params.pkg!)}\n\nSearch the [registry](/search).`
      },
      publicCache: 'hours',
    }) as never
  const bodies: string[] = []
  for (const kind of ['unstreamed', 'streamed'] as const) {
    upstream = notFound[kind]
    const response = await createMdHandler()(new Request(`${site}/x/%40acme%2Fnope.md`))
    expect([kind, response.status, response.headers.get('cache-control')]).toEqual([
      kind,
      404,
      'private, no-store',
    ])
    bodies.push(await response.text())
  }
  // the same body either way, with the unknown param it was asked for
  expect(bodies[0]).toBe(bodies[1])
  expect(bodies[0]).toBe(
    `---\ntitle: "No package @acme/nope"\nurl: "${site}/x/%40acme%2Fnope"\n---\n\n# No package @acme/nope\n\nSearch the [registry](/search).\n`,
  )
  expect(asked).toEqual([{ pkg: '%40acme%2Fnope' }, { pkg: '%40acme%2Fnope' }])
  // a 404 the default export or a fill throws runs it too
  authored[ROUTE] = async () =>
    ({
      default: () => {
        throw Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), {
          digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
        })
      },
      notFoundMarkdown: () => '# Gone',
    }) as never
  const thrown = await createMdHandler()(new Request(`${site}/x/express.md`))
  expect([thrown.status, (await thrown.text()).trim().split('\n').at(-1)]).toEqual([404, '# Gone'])
})

test("notFoundMarkdown returning undefined keeps the page's own 404, and a direct hit or a 200 never runs it", async () => {
  let runs = 0
  authored[ROUTE] = async () =>
    ({
      notFoundMarkdown: () => {
        runs++
        return undefined
      },
    }) as never
  // the converted not-found.tsx, and the fixed body for a streamed one, as before
  upstream = notFound.unstreamed
  const unstreamed = await createMdHandler()(new Request(`${site}/x/nope.md`))
  expect([unstreamed.status, await unstreamed.text()]).toEqual([
    404,
    expect.stringContaining('This page could not be found.'),
  ])
  upstream = notFound.streamed
  const streamed = await createMdHandler()(new Request(`${site}/x/nope.md`))
  expect([streamed.status, await streamed.text()]).toEqual([404, '# Not found\n'])
  expect(runs).toBe(2)
  // straight to the handler's url, which a page-scoped gate never saw: no markdown.ts, so no notFoundMarkdown
  upstream = notFound.unstreamed
  const direct = await createMdHandler()(new Request(`${site}/api/affordances/md/x/nope`))
  expect(direct.status).toBe(404)
  // a page that answered: nothing to say
  upstream = () =>
    new Response(page('<h1>express</h1>'), { headers: { 'content-type': 'text/html' } })
  expect((await createMdHandler()(new Request(`${site}/x/express.md`))).status).toBe(200)
  expect(runs).toBe(2)
})

test('one args.request per twin: the default export and every fill get the same object, so a WeakMap dedupes their data', async () => {
  for (const publicCache of [undefined, 'hours']) {
    const requests: Request[] = []
    authored[ROUTE] = async () =>
      ({
        default: ({ request }: { request: Request }) => {
          requests.push(request)
          return undefined
        },
        slots: {
          readme: ({ request }: { request: Request }) => {
            requests.push(request)
            return 'Readme.'
          },
          deps: ({ request }: { request: Request }) => {
            requests.push(request)
            return 'Deps.'
          },
        },
        ...(publicCache && { publicCache }),
      }) as never
    upstream = () =>
      new Response(page(`<h1>express</h1>${slot('readme')}${slot('deps')}`), {
        headers: { 'content-type': 'text/html' },
      })
    const response = await createMdHandler()(new Request(`${site}/x/express.md`))
    expect(await response.text()).toContain('Deps.')
    expect([publicCache, requests.length, new Set(requests).size]).toEqual([publicCache, 3, 1])
  }
})

test('a development warning is said once per route per process, never on every request', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  authored['/w/[pkg]'] = async () => ({ default: () => undefined }) as never
  vi.stubEnv(ROUTES_ENV, JSON.stringify([ROUTE, '/w/[pkg]']))
  upstream = () => new Response(page('<h1>w</h1>'), { headers: { 'content-type': 'text/html' } })
  for (const pkg of ['a', 'a', 'b']) await createMdHandler()(new Request(`${site}/w/${pkg}.md`))
  expect(warn.mock.calls.map(([message]) => message)).toEqual([
    '[affordances-md] /w/[pkg]/markdown.ts returned nothing for /w/a, so its HTML is converted',
  ])
  delete authored['/w/[pkg]']
  warn.mockRestore()
})
