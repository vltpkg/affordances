import type { NextConfig } from 'next'
import path from 'node:path'
import { expect, test } from 'vitest'
import { rewrites, toSource, withAffordances } from '../src/config.ts'

test('route patterns become header sources', () => {
  expect(toSource('/products/[slug]')).toBe('/products/:slug')
  expect(toSource('/docs/[...slug]')).toBe('/docs/:slug+')
  expect(toSource('/shop/[[...slug]]')).toBe('/shop/:slug*')
})

test('the page rewrite skips our handler and next internals', () => {
  const source = rewrites.find((r) => r.source.startsWith('/:path'))!.source
  const re = new RegExp(`^/${source.slice('/:path'.length)}$`)
  expect(re.test('/products/tee')).toBe(true)
  expect(re.test('/apis')).toBe(true)
  expect(re.test('/api/affordances/graph/products')).toBe(false)
  expect(re.test('/api/other')).toBe(false)
  expect(re.test('/_next/static/x.js')).toBe(false)
})

test('plugins wrap the config in order, after the graph', async () => {
  const order: string[] = []
  const plugin =
    (name: string) =>
    <C extends object>(config: C): C => {
      order.push(name)
      return { ...config, [name]: true }
    }
  const config = withAffordances({} as NextConfig, {
    root: path.join(import.meta.dirname, 'fixture'),
    plugins: [plugin('a'), plugin('b')],
  })
  expect(order).toEqual(['a', 'b'])
  expect(config).toMatchObject({ a: true, b: true })
  expect(config.rewrites).toBeTypeOf('function')
})

test('withAffordances prepends its rewrites and keeps the user config', async () => {
  const config = withAffordances(
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
  expect(h[0]!.headers).toContainEqual({
    key: 'Link',
    value: '<?affordances=1>; rel="affordances"',
  })
})
