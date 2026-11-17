import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { missingIds, render, scan, suggestId, writeIds } from '../src/codegen.ts'

// RFC 0001 §10.1: capability ids on v0 actions, read statically; suggestions for the ones without, never identities
const roots: string[] = []
const project = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'affordances-ids-'))
  roots.push(root)
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), source)
  }
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true })
})

const action = (local: string, extra = '') =>
  `export const ${local} = defineAction({\n  name: '${local}',${extra}\n  description: 'x',\n  run: () => {},\n})\n`

describe('scan reads an id like the name', () => {
  test('a literal id is read, and an action without one has none', () => {
    const root = project({
      'app/products/[slug]/actions.ts': `'use server'\n${action('addToCart', "\n  id: 'commerce.cart.addItem',")}${action('buyNow')}`,
    })
    expect(scan(root)[0]!.actions!.exports).toEqual([
      { local: 'addToCart', name: 'addToCart', id: 'commerce.cart.addItem' },
      { local: 'buyNow', name: 'buyNow' },
    ])
  })
  test.each([
    ['a non-literal id', '\n  id: ID,', "addToCart's `id` must be a string literal"],
    ['an id that is not an identifier', "\n  id: 'Commerce.cart',", "isn't an identifier"],
    ['an id with a dash', "\n  id: 'commerce.add-item',", "isn't an identifier"],
  ])('fails on %s', (_, extra, message) => {
    const root = project({ 'app/actions.ts': `'use server'\n${action('addToCart', extra)}` })
    expect(() => scan(root)).toThrow(message)
  })
  test('fails on one id for two actions, across routes', () => {
    const root = project({
      'app/a/actions.ts': `'use server'\n${action('one', "\n  id: 'shop.thing',")}`,
      'app/b/actions.ts': `'use server'\n${action('two', "\n  id: 'shop.thing',")}`,
    })
    expect(() => scan(root)).toThrow('shop.thing is the id of both one on /a and two on /b')
  })
})

describe('suggestId', () => {
  test.each([
    ['/products/[slug]', 'addToCart', 'products.addToCart'],
    ['/', 'search', 'search'],
    ['/account/orders', 'reorder', 'account.orders.reorder'],
    ['/docs/[...slug]', 'rate', 'docs.rate'],
    ['/shop/[[...path]]', 'add', 'shop.add'],
    ['/my-team/settings', 'Invite', 'myTeam.settings.invite'],
    ['/2026/plans', 'pick', 'r2026.plans.pick'],
  ])('%s and %s give %s', (route, name, expected) => {
    expect(suggestId(route, name)).toBe(expected)
  })
})

describe('missingIds (W_NO_ID)', () => {
  test('lists every action without an id, with a suggestion', () => {
    const root = project({
      'app/products/[slug]/actions.ts': `'use server'\n${action('addToCart')}${action('buyNow', "\n  id: 'commerce.buyNow',")}`,
      'app/actions.ts': `'use server'\n${action('search')}`,
    })
    expect(missingIds(scan(root))).toEqual([
      {
        code: 'W_NO_ID',
        route: '/',
        file: 'app/actions',
        local: 'search',
        name: 'search',
        suggested: 'search',
      },
      {
        code: 'W_NO_ID',
        route: '/products/[slug]',
        file: 'app/products/[slug]/actions',
        local: 'addToCart',
        name: 'addToCart',
        suggested: 'products.addToCart',
      },
    ])
  })
  test('two routes with the same static segments: the params, then a number', () => {
    const root = project({
      'app/items/[id]/actions.ts': `'use server'\n${action('save')}`,
      'app/items/[slug]/actions.ts': `'use server'\n${action('save')}`,
    })
    const suggested = missingIds(scan(root)).map((m) => m.suggested)
    expect(suggested).toEqual(['items.save', 'items.slug.save'])
  })
  test('a suggestion never takes an id already written', () => {
    const root = project({
      'app/actions.ts': `'use server'\n${action('search')}${action('find', "\n  id: 'search',")}`,
    })
    expect(missingIds(scan(root)).map((m) => m.suggested)).toEqual(['search2'])
  })
})

describe('writeIds, the codemod', () => {
  test('writes each suggestion after the name, in the file’s indentation, and touches nothing else', () => {
    const before = `'use server'\nimport { defineAction } from '@/lib/affordances'\n\n${action('addToCart')}\n${action('buyNow', "\n  id: 'commerce.buyNow',")}`
    const root = project({ 'app/products/[slug]/actions.ts': before })
    const written = writeIds(root)
    expect(written.map((m) => m.suggested)).toEqual(['products.addToCart'])
    const after = readFileSync(path.join(root, 'app/products/[slug]/actions.ts'), 'utf8')
    expect(after).toBe(
      before.replace("  name: 'addToCart',", "  name: 'addToCart',\n  id: 'products.addToCart',"),
    )
    // and the result is read back as the id, so nothing is missing now
    expect(missingIds(scan(root))).toEqual([])
  })
  test('a one-line config', () => {
    const root = project({
      'app/actions.ts': `'use server'\nexport const a = defineAction({ name: 'a', run: () => {} })\n`,
    })
    writeIds(root)
    expect(readFileSync(path.join(root, 'app/actions.ts'), 'utf8')).toBe(
      `'use server'\nexport const a = defineAction({ name: 'a', id: 'a', run: () => {} })\n`,
    )
  })
  test('a name with no trailing comma', () => {
    const root = project({
      'app/actions.ts': `'use server'\nexport const a = defineAction({\n  run: () => {},\n  name: 'a'\n})\n`,
    })
    writeIds(root)
    expect(readFileSync(path.join(root, 'app/actions.ts'), 'utf8')).toBe(
      `'use server'\nexport const a = defineAction({\n  run: () => {},\n  name: 'a',\n  id: 'a',\n})\n`,
    )
  })
  test('running it twice changes nothing more', () => {
    const root = project({ 'app/x/actions.ts': `'use server'\n${action('go')}` })
    writeIds(root)
    const once = readFileSync(path.join(root, 'app/x/actions.ts'), 'utf8')
    expect(writeIds(root)).toEqual([])
    expect(readFileSync(path.join(root, 'app/x/actions.ts'), 'utf8')).toBe(once)
  })
})

// a release before the IR is public changes nothing for existing apps: ids never reach v0's generated manifest
test('the generated manifest is byte-identical with and without ids', () => {
  const without = `'use server'\n${action('addToCart')}${action('buyNow')}`
  const withIds = `'use server'\n${action('addToCart', "\n  id: 'commerce.cart.addItem',")}${action('buyNow', "\n  id: 'commerce.buyNow',")}`
  const a = project({
    'app/products/[slug]/actions.ts': without,
    'app/products/[slug]/state.ts': 'export default defineState(() => ({}))',
  })
  const b = project({
    'app/products/[slug]/actions.ts': withIds,
    'app/products/[slug]/state.ts': 'export default defineState(() => ({}))',
  })
  expect(render(scan(b), { name: 'Shop' })).toBe(render(scan(a), { name: 'Shop' }))
})
