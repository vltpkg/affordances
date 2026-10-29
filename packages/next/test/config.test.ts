import path from 'node:path'
import { expect, test } from 'vitest'
import { rewrites, toSource, withAfford } from '../src/config.ts'

test('route patterns become header sources', () => {
  expect(toSource('/products/[slug]')).toBe('/products/:slug')
  expect(toSource('/docs/[...slug]')).toBe('/docs/:slug+')
  expect(toSource('/shop/[[...slug]]')).toBe('/shop/:slug*')
})

test('the page rewrite skips our handler and next internals', () => {
  const source = rewrites.find((r) => r.source.startsWith('/:path'))!.source
  const re = new RegExp(`^/${source.slice('/:path'.length)}$`)
  expect(re.test('/products/tee')).toBe(true)
  expect(re.test('/api/afforded')).toBe(true)
  expect(re.test('/api/afford')).toBe(false)
  expect(re.test('/api/afford/products')).toBe(false)
  expect(re.test('/_next/static/x.js')).toBe(false)
})

test('withAfford prepends its rewrites and keeps the user config', async () => {
  const config = withAfford(
    {
      reactCompiler: true,
      rewrites: async () => [{ source: '/old', destination: '/new' }],
      headers: async () => [{ source: '/x', headers: [{ key: 'a', value: 'b' }] }],
    },
    { root: path.join(import.meta.dirname, 'fixture') },
  )
  expect(config.reactCompiler).toBe(true)
  const r = (await config.rewrites!()) as unknown as {
    beforeFiles: unknown[]
    afterFiles: unknown[]
  }
  expect(r.beforeFiles).toEqual(rewrites)
  expect(r.afterFiles).toEqual([{ source: '/old', destination: '/new' }])
  const h = await config.headers!()
  expect(h.map((x) => x.source)).toEqual(['/cart', '/products/:slug', '/x'])
  expect(h[0]!.headers).toContainEqual({ key: 'Link', value: '<?afford=1>; rel="afford"' })
})
