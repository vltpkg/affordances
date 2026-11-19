import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, vi } from 'vitest'

// M7b (3): what apps/example, a v0-only app, serves on v0's wire, written as one JSON document so two checkouts can be
// diffed byte for byte. Run in a clean export of each commit, from apps/example:
// `npx vitest run --config scripts/v0-golden/vitest.config.ts` writes scripts/v0-golden/out.json. Next's request store isn't there outside Next, so its two helpers are stubbed: a
// cookie jar that holds nothing, and a revalidatePath that does nothing

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}))

const root = path.resolve(import.meta.dirname, '../..')
const origin = 'https://example.test'
const MEDIA_TYPE = 'application/vnd.affordances+json'
// every route, at a concrete url, with and without a session
const URLS = [
  '/',
  '/cart',
  '/checkout',
  '/account/orders',
  '/search?q=tee',
  '/products/heavyweight-tee',
]

test('apps/example’s v0 documents, written for the diff', async () => {
  const { generate } = await import('@affordances/next/codegen')
  generate(root)
  const { manifest } = (await import(
    pathToFileURL(path.join(root, '.affordances', 'manifest.ts')).href
  )) as {
    manifest: never
  }
  const { createRouteHandler } = await import('@affordances/next/route')
  const handler = createRouteHandler({ manifest })
  const fetchJson = async (url: string, init: RequestInit = {}) => {
    const response = await handler(new Request(`${origin}${url}`, init))
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      body: await response.json(),
    }
  }
  const out: Record<string, unknown> = {}
  for (const url of URLS)
    for (const sid of [undefined, 'golden-sid']) {
      const graphUrl = `/api/affordances/graph${url === '/' ? '' : url}`
      out[`GET ${graphUrl}${sid ? ' (session)' : ''}`] = await fetchJson(graphUrl, {
        headers: { accept: MEDIA_TYPE, ...(sid && { authorization: `Bearer ${sid}` }) },
      })
    }
  out['GET /.well-known/affordances.json'] = await fetchJson('/.well-known/affordances.json')
  // Calls: a public query, an action that needs a session, without one and with one, and an unknown action
  const call = (route: string, body: unknown, sid?: string) =>
    fetchJson(`/api/affordances/graph${route}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': MEDIA_TYPE, ...(sid && { authorization: `Bearer ${sid}` }) },
    })
  out['POST / search'] = await call('', { action: 'search', input: { query: 'tee' } })
  out['POST /products/heavyweight-tee addToCart'] = await call('/products/heavyweight-tee', {
    action: 'addToCart',
    input: { sku: 'TEE-BLK-M' },
  })
  out['POST /products/heavyweight-tee addToCart (session)'] = await call(
    '/products/heavyweight-tee',
    { action: 'addToCart', input: { sku: 'TEE-BLK-M' } },
    'golden-sid',
  )
  out['POST / nothing'] = await call('', { action: 'nothing' })
  writeFileSync(path.join(import.meta.dirname, 'out.json'), `${JSON.stringify(out, null, 2)}\n`)
  expect(Object.keys(out).length).toBe(URLS.length * 2 + 5)
})
