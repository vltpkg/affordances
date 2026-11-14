import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createMdHandler } from '../src/next/index.ts'
import { ROUTES_ENV } from '../src/next/routes.ts'

// a conversion that throws for a reason md didn't foresee: switched on per test, in readStreamed (reading the page) or
// in the markdown it hands back (converting it)
const boom = vi.hoisted(() => ({ in: undefined as 'read' | 'markdown' | undefined }))
vi.mock('../src/convert/index.ts', async (original) => {
  const actual = await original<typeof import('../src/convert/index.ts')>()
  return {
    ...actual,
    readStreamed: (...args: Parameters<typeof actual.readStreamed>) => {
      if (boom.in === 'read') throw new TypeError('something md never expected')
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
beforeEach(() => {
  body = '<h1>express</h1>'
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        `<html><head><title>Express</title></head><body><main>${body}</main></body></html>`,
        {
          headers: { 'content-type': 'text/html' },
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
  // logged once per process, in production too
  expect(error.mock.calls.map(([message]) => message)).toEqual([
    expect.stringMatching(
      /^\[affordances-md\] \/x\/express couldn't be converted \(TypeError: something md never expected\), so it answers 502, private, no-store\./,
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
