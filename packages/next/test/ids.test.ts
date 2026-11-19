import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { missingIds, render, scan, suggestId, writeIds } from '../src/codegen.ts'
import { extract } from '../src/extract.ts'

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
  // M8-ids: with the target's type known (E9's, as written), the suggestion is the type, the route's folders after the
  // target, and the action's name, the verb as the developer wrote it; without one, the route's folders and the name
  test("with the target's type known, the type, the folders after the target, and the action's name", () => {
    const root = project({
      'app/shop/products/[slug]/reviews/actions.ts': `'use server'\n${action('add')}${action('createNewReview')}`,
      'app/shop/products/[slug]/reviews/drafts/actions.ts': `'use server'\n${action('save')}`,
      'app/products/[slug]/actions.ts': `'use server'\n${action('addToCart')}`,
      'app/cart/actions.ts': `'use server'\n${action('updateQuantity')}`,
    })
    expect(missingIds(scan(root)).map((m) => [m.route, m.suggested])).toEqual([
      // no target type: the folders, as before
      ['/cart', 'cart.updateQuantity'],
      // a route ending at its target: the type and the name, as the folder form gave it
      ['/products/[slug]', 'products.addToCart'],
      // one folder after the target, then two; the folders before the type's (shop) aren't part of it. The verb is the
      // name as written, never mapped to a standard one
      ['/shop/products/[slug]/reviews', 'products.reviews.add'],
      ['/shop/products/[slug]/reviews', 'products.reviews.createNewReview'],
      ['/shop/products/[slug]/reviews/drafts', 'products.reviews.drafts.save'],
    ])
    expect(missingIds(scan(root), { idPrefix: 'acmeStore' }).map((m) => m.suggested)).toEqual([
      'acmeStore.cart.updateQuantity',
      'acmeStore.products.addToCart',
      'acmeStore.products.reviews.add',
      'acmeStore.products.reviews.createNewReview',
      'acmeStore.products.reviews.drafts.save',
    ])
  })
  test('a type two routes infer with different keys is no target, so its suggestions fall back to the folders', () => {
    const root = project({
      'app/items/[id]/edit/actions.ts': `'use server'\n${action('rename')}`,
      'app/items/[slug]/actions.ts': `'use server'\n${action('archive')}`,
    })
    expect(missingIds(scan(root)).map((m) => m.suggested)).toEqual([
      'items.edit.rename',
      'items.archive',
    ])
  })
  test('one suggestion function: the W_NO_ID diagnostic suggests what the codemod writes', () => {
    const root = project({
      'app/shop/products/[slug]/reviews/actions.ts': `'use server'\n${action('add')}`,
    })
    const [missing] = missingIds(scan(root))
    const diagnostic = extract(root).diagnostics.find((d) => d.code === 'W_NO_ID')
    expect(diagnostic?.detail).toBe(`id: '${missing!.suggested}'`)
    // and what it writes is a placeholder, typed or not: the id is the developer's to choose
    writeIds(root)
    expect(
      readFileSync(path.join(root, 'app/shop/products/[slug]/reviews/actions.ts'), 'utf8'),
    ).toContain("id: 'products.reviews.add', // placeholder: choose this action's id")
  })
  test('a suggestion never takes an id already written', () => {
    const root = project({
      'app/actions.ts': `'use server'\n${action('search')}${action('find', "\n  id: 'search',")}`,
    })
    expect(missingIds(scan(root)).map((m) => m.suggested)).toEqual(['search2'])
  })
})

// what writeIds makes of one actions file
const written = (source: string) => {
  const root = project({ 'app/actions.ts': `'use server'\n${source}` })
  writeIds(root)
  return readFileSync(path.join(root, 'app/actions.ts'), 'utf8').slice("'use server'\n".length)
}

describe('writeIds, the codemod', () => {
  test('writes each suggestion before the name, in the file’s indentation, and touches nothing else', () => {
    const before = `'use server'\nimport { defineAction } from '@/lib/affordances'\n\n${action('addToCart')}\n${action('buyNow', "\n  id: 'commerce.buyNow',")}`
    const root = project({ 'app/products/[slug]/actions.ts': before })
    expect(writeIds(root).map((m) => m.suggested)).toEqual(['products.addToCart'])
    const after = readFileSync(path.join(root, 'app/products/[slug]/actions.ts'), 'utf8')
    expect(after).toBe(
      before.replace(
        "  name: 'addToCart',",
        "  id: 'products.addToCart', // placeholder: choose this action's id\n  name: 'addToCart',",
      ),
    )
    // and the result is read back as the id, so nothing is missing now
    expect(missingIds(scan(root))).toEqual([])
  })
  test('a one-line config', () => {
    expect(written(`export const a = defineAction({ name: 'a', run: () => {} })\n`)).toBe(
      `export const a = defineAction({ id: 'a' /* placeholder */, name: 'a', run: () => {} })\n`,
    )
  })
  test('a name with no trailing comma', () => {
    expect(written(`export const a = defineAction({\n  run: () => {},\n  name: 'a'\n})\n`)).toBe(
      `export const a = defineAction({\n  run: () => {},\n  id: 'a', // placeholder: choose this action's id\n  name: 'a'\n})\n`,
    )
  })
  // review's cases: a comment between the name and its comma
  test('a block comment before the comma', () => {
    expect(written(`export const a = defineAction({ name: 'a' /* c */, run: () => {} })\n`)).toBe(
      `export const a = defineAction({ id: 'a' /* placeholder */, name: 'a' /* c */, run: () => {} })\n`,
    )
  })
  test('a line comment, with the comma on the next line', () => {
    expect(
      written(`export const a = defineAction({\n  name: 'a' // c\n  , run: () => {},\n})\n`),
    ).toBe(
      `export const a = defineAction({\n  id: 'a', // placeholder: choose this action's id\n  name: 'a' // c\n  , run: () => {},\n})\n`,
    )
  })
  test('every layout re-parses, and reads back with the id', () => {
    const layouts = [
      `({ name: 'a', run: () => {} })`,
      `({\n\tname: 'a',\n\trun: () => {},\n})`,
      `({ run: () => {}, name: 'a' })`,
      `({ name: /* n */ 'a' /* c */ , run: () => {} })`,
      `({\n  // the name\n  name: 'a', // ok\n  run: () => {},\n})`,
      `({ description: 'a, b', name: 'a', run: () => {} })`,
    ]
    for (const config of layouts) {
      const root = project({
        'app/actions.ts': `'use server'\nexport const a = defineAction${config}\n`,
      })
      writeIds(root)
      // scan re-parses the file, and throws on a syntax error
      expect([config, scan(root)[0]!.actions!.exports]).toEqual([
        config,
        [{ local: 'a', name: 'a', id: 'a' }],
      ])
    }
  })
  // intake, 2026-11-18: ids are the developer's to choose, so what the codemod writes says it's a placeholder
  test('every id it writes is labelled a placeholder, in the source', () => {
    const out = written(`export const a = defineAction({\n  name: 'a',\n  run: () => {},\n})\n`)
    expect(out).toContain("id: 'a', // placeholder: choose this action's id")
    expect(written(`export const a = defineAction({ name: 'a', run: () => {} })\n`)).toContain(
      "id: 'a' /* placeholder */",
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

// code review 9: defineAction({ capability }) is identified by its capability, so codegen never asks it for an id
describe('a capability-bound action', () => {
  const bound = `'use server'\nimport { defineAction } from '@/lib/affordances'\nimport { cancel as c } from '@/manifest'\n\nexport const cancel = defineAction({\n  capability: c,\n  name: 'cancel',\n  run: () => {},\n})\n${action('other')}`
  test('gets no W_NO_ID, and writeIds never writes into it', () => {
    const root = project({ 'app/actions.ts': bound })
    expect(missingIds(scan(root)).map((m) => m.local)).toEqual(['other'])
    writeIds(root)
    const after = readFileSync(path.join(root, 'app/actions.ts'), 'utf8')
    // the bound one is byte for byte as it was; the other got its id before its name
    expect(after.slice(0, after.indexOf('export const other'))).toBe(
      bound.slice(0, bound.indexOf('export const other')),
    )
    expect(after).toContain(
      "id: 'other', // placeholder: choose this action's id\n  name: 'other',",
    )
  })
  test('on hosting-lab, every action is bound, so none is flagged', () => {
    const root = path.resolve(import.meta.dirname, '../../../apps/hosting-lab')
    const exports = scan(root).flatMap((e) => e.actions?.exports ?? [])
    expect(exports.length).toBeGreaterThan(0)
    expect(exports.every((x) => x.bound)).toBe(true)
    expect(missingIds(scan(root))).toEqual([])
  })
})

// boundary review #11's idPrefix part, promoted (intake, 2026-11-18 12:26Z): withAffordances' idPrefix, from the
// site's name, leads every suggested and written id, and none is written without one (RFC 0005 §1)
describe('idPrefix', () => {
  const files = {
    'app/products/[slug]/actions.ts': `'use server'\n${action('addToCart')}${action('buyNow')}`,
    'app/actions.ts': `'use server'\n${action('search')}`,
  }
  // every id in the files, as written
  const idsIn = (root: string) =>
    Object.keys(files)
      .flatMap((f) => [...readFileSync(path.join(root, f), 'utf8').matchAll(/id: '([^']+)'/g)])
      .map((m) => m[1]!)

  test('a configured prefix leads every suggestion and every written id', () => {
    const root = project(files)
    expect(missingIds(scan(root), { idPrefix: 'acmeStore' }).map((m) => m.suggested)).toEqual([
      'acmeStore.search',
      'acmeStore.products.addToCart',
      'acmeStore.products.buyNow',
    ])
    writeIds(root, { idPrefix: 'acmeStore' })
    const prefixed = idsIn(root)
    expect(prefixed).toHaveLength(3)
    expect(prefixed.every((id) => id.startsWith('acmeStore.'))).toBe(true)
    // read back as ids, nothing missing
    expect(missingIds(scan(root), { idPrefix: 'acmeStore' })).toEqual([])
  })

  test('without one, no prefix is written', () => {
    const root = project(files)
    writeIds(root)
    expect(idsIn(root).toSorted()).toEqual(['products.addToCart', 'products.buyNow', 'search'])
  })

  test('a taken suggestion still disambiguates under the prefix', () => {
    const root = project({
      'app/actions.ts': `'use server'\n${action('search')}${action('find', "\n  id: 'acmeStore.search',")}`,
    })
    expect(missingIds(scan(root), { idPrefix: 'acmeStore' }).map((m) => m.suggested)).toEqual([
      'acmeStore.search2',
    ])
  })
})
