import { Delta, Graph, MEDIA_TYPE } from '@afford/protocol'
import { beforeAll, expect, test } from 'vitest'
import { generate } from '../src/codegen.ts'
import { createRouteHandler } from '../src/route.ts'
import path from 'node:path'

let handler: (request: Request) => Promise<Response>
beforeAll(async () => {
  generate(path.join(import.meta.dirname, 'fixture'), { name: 'Fixture' })
  // @ts-ignore generated
  const { manifest } = await import('./fixture/.afford/manifest.ts')
  handler = createRouteHandler(manifest)
})

const url = (p: string) => `http://shop.test/api/afford/graph${p}`

test('serves the graph for a rewritten page url', async () => {
  const graph = Graph.parse(await (await handler(new Request(url('/products/tee')))).json())
  expect(graph).toMatchObject({
    page: '/products/tee',
    route: '/products/[slug]',
    entities: { product: { stock: 2 } },
  })
})

test('the root and the well-known index resolve', async () => {
  const index = await (await handler(new Request(url('/.well-known/afford.json')))).json()
  expect(index).toMatchObject({
    name: 'Fixture',
    routes: [{ route: '/cart' }, { route: '/products/[slug]' }],
  })
  expect((await handler(new Request(url('')))).status).toBe(404)
})

test('calls return a delta', async () => {
  const response = await handler(
    new Request(url('/products/tee'), {
      method: 'POST',
      headers: { 'content-type': MEDIA_TYPE },
      body: JSON.stringify({ action: 'addToCart', input: { slug: 'tee' } }),
    }),
  )
  expect(Delta.parse(await response.json())).toEqual({ ok: true, changed: { cart: { count: 1 } } })
})

test("next's redirect() becomes the delta's redirect", async () => {
  const response = await handler(
    new Request(url('/products/tee'), {
      method: 'POST',
      headers: { 'content-type': MEDIA_TYPE, authorization: 'Bearer a' },
      body: JSON.stringify({ action: 'buyNow', input: {} }),
    }),
  )
  expect(await response.json()).toEqual({ ok: true, redirect: '/checkout' })
})
