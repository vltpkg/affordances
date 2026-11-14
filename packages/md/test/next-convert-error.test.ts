import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createMdHandler } from '../src/next/index.ts'
import { ROUTES_ENV } from '../src/next/routes.ts'

// a conversion that throws for a reason md didn't foresee: switched on per test, in readStreamed (reading the page) or
// in the markdown it hands back (converting it). the read's error has a cause, as when md tried the other path too
const boom = vi.hoisted(() => ({ in: undefined as 'read' | 'markdown' | 'flight' | undefined }))
vi.mock('../src/convert/index.ts', async (original) => {
  const actual = await original<typeof import('../src/convert/index.ts')>()
  return {
    ...actual,
    readStreamed: (...args: Parameters<typeof actual.readStreamed>) => {
      // swaps that can't be trusted, found once md-core's read had thrown
      if (boom.in === 'flight')
        throw Object.assign(new actual.FlightDataError('count'), {
          cause: new TypeError('md-core broke first'),
        })
      if (boom.in === 'read')
        throw new TypeError('something md never expected', {
          cause: new SyntaxError('the other path broke'),
        })
      const page = actual.readStreamed(...args)
      return {
        ...page,
        markdown: (slots?: Record<string, string>) => {
          if (boom.in === 'markdown') throw new RangeError('Maximum call stack size exceeded')
          return page.markdown(slots)
        },
      }
    },
  }
})

const site = 'https://shop.test'
const ROUTE = '/x/[pkg]'
let body = '<h1>express</h1>'
// what's after the page's <main>, and the cache-control the page answers with
let after = ''
let cacheControl: string | undefined
beforeEach(() => {
  body = '<h1>express</h1>'
  after = ''
  cacheControl = undefined
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        `<html><head><title>Express</title></head><body><main>${body}</main>${after}</body></html>`,
        {
          headers: {
            'content-type': 'text/html',
            ...(cacheControl && { 'cache-control': cacheControl }),
          },
        },
      ),
  )
  process.env[ROUTES_ENV] = JSON.stringify([ROUTE])
})
afterEach(() => {
  boom.in = undefined
  vi.unstubAllGlobals()
  delete process.env[ROUTES_ENV]
})

const get = async () => {
  const response = await createMdHandler()(new Request(`${site}/x/express.md`))
  return [
    response.status,
    response.headers.get('cache-control'),
    (await response.text()).includes('express'),
  ]
}

test('any error from converting a page answers 502, private, no-store, with nothing of the page in it', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await get()).toEqual([200, expect.any(String), true])
  for (const where of ['read', 'markdown'] as const) {
    boom.in = where
    expect([where, ...(await get())]).toEqual([where, 502, 'private, no-store', false])
  }
  // logged once per process, in production too, naming the error and its cause
  expect(error.mock.calls.map(([message]) => message)).toEqual([
    expect.stringMatching(
      /^\[affordances-md\] \/x\/express couldn't be converted \(TypeError: something md never expected, cause SyntaxError: the other path broke\), so it answers 502, private, no-store\./,
    ),
  ])
  error.mockRestore()
})

test("flight data that can't be read is logged with what md threw before it, if anything", async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  boom.in = 'flight'
  expect(await get()).toEqual([502, 'private, no-store', false])
  expect(error.mock.calls.map(([message]) => message)).toEqual([
    expect.stringMatching(
      /^\[affordances-md\] \/x\/express's Flight data couldn't be read \(count, cause TypeError: md-core broke first\), so it answers 502, private, no-store\./,
    ),
  ])
  error.mockRestore()
})

test('a page nested 2,000, 20,000 and 100,000 deep, of divs or svgs, is read up to the cut through the route, quickly', async () => {
  for (const tag of ['div', 'svg'])
    for (const n of [2_000, 20_000, 100_000]) {
      body = `<h1>express</h1>${`<${tag}>`.repeat(n)}deep${`</${tag}>`.repeat(n)}`
      const started = performance.now()
      const response = await createMdHandler()(new Request(`${site}/x/express.md`))
      const text = await response.text()
      // generous: far under what reading the whole nesting takes
      expect(performance.now() - started).toBeLessThan(2_000)
      expect([
        tag,
        n,
        response.status,
        response.headers.get('x-affordances-md-partial'),
        text.includes('# express\n'),
        text.includes(
          'This page nests deeper than @affordances/md reads, so some of it is missing.',
        ),
      ]).toEqual([tag, n, 200, '1', true, true])
    }
}, 30_000)

test('a page parse5 throws on answers 502, private, no-store, through the route', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  body = '<table><svg><select><foreignObject><select><td><article><span></ul><svg><del><form>'
  expect(await get()).toEqual([502, 'private, no-store', false])
  error.mockRestore()
})

// a page cut short is never served as complete or cached, whatever the page's own cache-control: each way a page nests
// too deep. and a push or a boundary nested deep reads as it does shallow, so the page is whole (a stalled stream's
// partial page is next.test's)
const nested = (n: number, inner: string, tag = 'div') =>
  `<${tag}>`.repeat(n) + inner + `</${tag}>`.repeat(n)
const flightPush = (row: string) =>
  `<script>self.__next_f.push(${JSON.stringify([1, row])})</script>`
const suspended = '<!--$?--><template id="B:0"></template><p>FALLBACK</p><!--/$-->'
const segment = '<div hidden id="S:0"><p>MOVED</p></div><script>$RC("B:0","S:0")</script>'
test.each([
  ['a plain page', '<p>words</p>', '', 'public, max-age=60', null],
  ['a cut past 512', nested(600, 'deep'), '', 'private, no-store', '1'],
  [
    'a flatten past 128 leaving something out',
    nested(140, '<span class="x">said</span>'),
    '',
    'private, no-store',
    '1',
  ],
  ['a cut dropping a push', nested(600, 'deep'), flightPush('0:x\n'), 'private, no-store', '1'],
  ['a cut dropping a boundary', nested(600, suspended), segment, 'private, no-store', '1'],
  ['a cut dropping a segment', suspended + nested(600, segment), '', 'private, no-store', '1'],
  ['a push past 128', nested(140, `words${flightPush('0:x\n')}`), '', 'public, max-age=60', null],
  [
    'a boundary past 128, its segment shallow',
    nested(140, suspended),
    segment,
    'public, max-age=60',
    null,
  ],
])(
  '%s: the route answers with its cache-control and partial header',
  async (_, main, rest, cache, partial) => {
    cacheControl = 'public, max-age=60'
    body = `<h1>express</h1>${main}`
    after = rest
    const response = await createMdHandler()(new Request(`${site}/x/express.md`))
    const text = await response.text()
    expect([
      response.status,
      response.headers.get('cache-control'),
      response.headers.get('x-affordances-md-partial'),
    ]).toEqual([200, cache, partial])
    // a page served whole never shows a fallback (a partial one may: its segment was cut)
    expect(!partial && text.includes('FALLBACK')).toBe(false)
  },
)
