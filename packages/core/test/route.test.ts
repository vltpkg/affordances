import { expect, test } from 'vitest'
import { compile, match, sort } from '../src/route.ts'

test('matches next app router patterns', () => {
  expect(match(compile('/'), '/')).toEqual({})
  expect(match(compile('/products/[slug]'), '/products/tee')).toEqual({ slug: 'tee' })
  expect(match(compile('/products/[slug]'), '/products/tee/extra')).toBeUndefined()
  expect(match(compile('/docs/[...slug]'), '/docs')).toBeUndefined()
  expect(match(compile('/docs/[...slug]'), '/docs/a/b%20c')).toEqual({ slug: ['a', 'b c'] })
  expect(match(compile('/shop/[[...slug]]'), '/shop')).toEqual({})
  expect(match(compile('/shop/[[...slug]]'), '/shop/a')).toEqual({ slug: ['a'] })
})

test('sorts static before dynamic before catch-all', () => {
  const order = sort(['/[...all]', '/[id]', '/about', '/[id]/edit'].map(compile)).map(
    (r) => r.pattern,
  )
  expect(order).toEqual(['/about', '/[id]/edit', '/[id]', '/[...all]'])
})
