import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
// the IR's own schema, by path: next takes @affordances/ir as a devDependency once the shared lockfile is free
import { CapabilityDefinition } from '../../ir/src/schema.ts'
import { writeIds } from '../src/codegen.ts'
import { extract, segmentResource, SOURCE } from '../src/extract.ts'

// RFC 0005 §2.1's rules E1 to E9, each read from a literal, each with its basis, over a fixture app and over a copy
// of apps/example

let root: string
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}
const HEAD =
  "'use server'\nimport { defineAction } from '@affordances/next'\nimport { z } from 'zod'\n"

beforeAll(() => {
  root = mkdtempSync(path.join(import.meta.dirname, '.extract-'))
  write(
    'app/products/[slug]/actions.ts',
    `${HEAD}export const addToCart = defineAction({
  name: 'addToCart',
  id: 'shop.cart.add',
  description: 'Add a product to the cart',
  input: z.object({ slug: z.string(), quantity: z.number().int() }),
  expose: 'confirm',
  requires: 'The product is in stock',
  guard: async () => true,
  run: async () => {},
})
`,
  )
  write(
    'app/search/actions.ts',
    `${HEAD}export const search = defineAction({
  name: 'search',
  id: 'shop.search',
  description: 'Search the catalog',
  readOnly: true,
  expose: 'public',
  input: z.object({ q: z.string().refine((s) => s.length > 0) }),
  run: async () => [],
})
`,
  )
  write(
    'app/account/actions.ts',
    `${HEAD}const level = 'session'
export const rename = defineAction({
  name: 'rename',
  description: 'Rename the account',
  expose: level,
  input: z.object({ name: z.string() }),
  run: async () => {},
})
export const close = defineAction({
  name: 'close',
  id: 'shop.account.close',
  description: \`Close the account\`,
  expose: level,
  input: z.object({}).default(makeDefault()),
  run: async () => {},
})
function makeDefault() { return {} }
`,
  )
  write(
    'app/bound/actions.ts',
    `${HEAD}import { subscribe } from '../capabilities'
export const sub = defineAction({ capability: subscribe, name: 'sub', input: z.object({}), run: async () => {} })
`,
  )
  // two routes inferring one resource type with different keys (review of 8d2b22e1)
  write(
    'app/widgets/[slug]/actions.ts',
    `${HEAD}export const view = defineAction({ name: 'view', id: 'shop.ab', description: 'View it', input: z.object({ slug: z.string() }), run: async () => {} })
`,
  )
  write(
    'app/widgets/[id]/edit/actions.ts',
    `${HEAD}export const edit = defineAction({ name: 'edit', id: 'shop.aB', description: 'Edit it', input: z.object({}), run: async () => {} })
`,
  )
  write(
    'app/my-items/[id]/actions.ts',
    `${HEAD}export const touch = defineAction({ name: 'touch', id: 'shop.items.touch', description: 'Touch it', input: z.object({}), run: async () => {} })
`,
  )
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

test('E1 to E9 on one action: the binding, id, input, kind, authorization, confirmation, guard, description and target', () => {
  const r = extract(root)
  const add = r.capabilities.find((c) => c.id === 'shop.cart.add')
  const evidence = [{ description: 'defineAction addToCart in app/products/[slug]/actions.ts:4' }]
  const imported = { source: SOURCE.id, basis: 'imported', evidence }
  const inferred = { source: SOURCE.id, basis: 'inferred' }
  expect(add).toEqual({
    id: 'shop.cart.add',
    kind: 'action',
    description: 'Add a product to the cart',
    target: 'products',
    targetAt: '/slug',
    input: expect.objectContaining({ type: 'object', required: ['slug', 'quantity'] }),
    authorization: { principal: 'authenticated' },
    confirmation: { summary: 'Run addToCart' },
    preconditions: [{ id: 'guard', description: 'The product is in stock', guard: true }],
    provenance: inferred,
    fieldProvenance: {
      '/id': imported,
      '/kind': imported,
      '/description': imported,
      '/authorization': imported,
      '/confirmation': imported,
      '/confirmation/summary': inferred,
      '/preconditions': imported,
      '/input': inferred,
      '/target': inferred,
      '/targetAt': inferred,
    },
  })
  expect(r.bindings.find((b) => b.capability === 'shop.cart.add')).toEqual({
    capability: 'shop.cart.add',
    protocol: 'affordances/v0',
    address: { route: '/products/[slug]', action: 'addToCart' },
    export: { file: 'app/products/[slug]/actions.ts', local: 'addToCart' },
    params: { slug: { from: 'target' } },
    guards: { guard: { file: 'app/products/[slug]/actions.ts', local: 'addToCart' } },
  })
  // E9's resource: the segment as written, never singularized
  expect(r.resources).toEqual([
    {
      id: 'products',
      key: 'slug',
      description: 'A products resource, from the route segment /products/[slug]',
      provenance: inferred,
    },
  ])
})

test('a query, a public action, and a lossy input', () => {
  const r = extract(root)
  expect(r.capabilities.find((c) => c.id === 'shop.search')).toMatchObject({
    kind: 'query',
    authorization: { principal: 'any' },
  })
  expect(
    r.diagnostics.filter((d) => d.subject === 'search').map((d) => [d.code, d.detail]),
  ).toEqual([['W_INPUT_LOSSY', 'refine']])
})

test('what isn’t a literal is read as absent, never guessed: no id, a computed expose, an opaque input', () => {
  const r = extract(root)
  // no id: a suggestion, and no capability
  expect(r.diagnostics.find((d) => d.subject === 'rename' && d.code === 'W_NO_ID')).toMatchObject({
    code: 'W_NO_ID',
    detail: "id: 'account.rename'",
  })
  expect(r.capabilities.some((c) => c.id.endsWith('rename'))).toBe(false)
  // a computed expose: no authorization, so the capability isn't exposed (RFC 0002 §4.3), and said so
  expect(
    r.diagnostics.filter((d) => d.code === 'W_NOT_LITERAL').map((d) => [d.subject, d.detail]),
  ).toEqual([
    ['rename', 'expose'],
    ['close', 'expose'],
  ])
  const close = r.capabilities.find((c) => c.id === 'shop.account.close')!
  expect(close).not.toHaveProperty('authorization')
  expect(close).not.toHaveProperty('input')
  expect(close.description).toBe('Close the account')
  expect(
    r.diagnostics.find((d) => d.subject === 'close' && d.code === 'W_INPUT_OPAQUE')?.detail,
  ).toMatch(/makeDefault is a function/)
})

test('a bound action extracts nothing but its binding, and lists the v0 fields it also sets', () => {
  expect(extract(root).bound).toEqual([
    {
      route: '/bound',
      action: 'sub',
      export: { file: 'app/bound/actions.ts', local: 'sub' },
      capability: { local: 'subscribe', from: '../capabilities', imported: 'subscribe' },
      alsoSets: ['input'],
    },
  ])
})

test('E9 takes the last dynamic segment under a static one whose name is an identifier, and nothing else', () => {
  expect(segmentResource('/products/[slug]')).toEqual({ id: 'products', key: 'slug' })
  expect(segmentResource('/orgs/[org]/projects/[id]')).toEqual({ id: 'projects', key: 'id' })
  expect(segmentResource('/my-items/[id]')).toBeUndefined()
  expect(segmentResource('/docs/[...path]')).toBeUndefined()
  expect(segmentResource('/[a]/[b]')).toBeUndefined()
  expect(segmentResource('/cart')).toBeUndefined()
  expect(extract(root).capabilities.find((c) => c.id === 'shop.items.touch')).not.toHaveProperty(
    'target',
  )
})

test('every extracted capability is a valid IR definition, and extraction is deterministic', () => {
  const a = extract(root)
  for (const c of a.capabilities)
    expect(CapabilityDefinition.safeParse(c).error?.issues).toBeUndefined()
  expect(JSON.stringify(extract(root))).toBe(JSON.stringify(a))
})

test('over a copy of apps/example with its suggested ids written, every input converts and every rule reads', () => {
  const copy = mkdtempSync(path.join(import.meta.dirname, '.extract-example-'))
  try {
    cpSync(
      path.join(import.meta.dirname, '..', '..', '..', 'apps', 'example', 'src'),
      path.join(copy, 'src'),
      {
        recursive: true,
      },
    )
    writeIds(copy)
    const r = extract(copy)
    expect(
      r.capabilities.map((c) => [
        c.id,
        c.kind,
        c.authorization?.principal,
        !!c.confirmation,
        !!c.input,
      ]),
    ).toEqual([
      ['cart.removeItem', 'action', 'authenticated', false, true],
      ['cart.updateQuantity', 'action', 'authenticated', false, true],
      ['checkout.placeOrder', 'action', 'authenticated', true, true],
      ['products.addToCart', 'action', 'any', false, true],
      ['search', 'query', 'any', false, true],
    ])
    expect(r.resources.map((x) => [x.id, x.key])).toEqual([['products', 'slug']])
    expect(r.diagnostics.filter((d) => /W_INPUT_(OPAQUE|LOSSY)|W_NO_ID/.test(d.code))).toEqual([])
    for (const c of r.capabilities)
      expect(CapabilityDefinition.safeParse(c).error?.issues).toBeUndefined()
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}, 120_000)

test('a resource type two routes infer with different keys is used by neither, and the conflict is reported', () => {
  const r = extract(root)
  expect(r.diagnostics.filter((d) => d.code === 'W_SEGMENT_CONFLICT')).toEqual([
    {
      code: 'W_SEGMENT_CONFLICT',
      file: 'app',
      subject: 'widgets',
      detail: '/widgets/[id]/edit, /widgets/[slug]',
    },
  ])
  expect(r.resources.map((x) => x.id)).not.toContain('widgets')
  for (const id of ['shop.ab', 'shop.aB'])
    expect(r.capabilities.find((c) => c.id === id)).not.toHaveProperty('target')
})

test('everything is ordered by UTF-16 code unit, as the IR’s canonical order is, never by locale', () => {
  const ids = extract(root).capabilities.map((c) => c.id)
  // 'B' (0x42) sorts before 'b' (0x62); a locale order would put shop.ab first
  expect(ids.indexOf('shop.aB')).toBeLessThan(ids.indexOf('shop.ab'))
  expect(ids).toEqual([...ids].toSorted())
})
