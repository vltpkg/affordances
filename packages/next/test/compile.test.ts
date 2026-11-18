import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { compile, writeCompiled } from '../src/compile.ts'

// RFC 0005 §4's pipeline: capability modules and extraction, merged, normalized and validated, then written

let root: string
let n = 0
const app = (files: Record<string, string>) => {
  const dir = path.join(root, `app${n++}`)
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
beforeAll(() => {
  root = mkdtempSync(path.join(import.meta.dirname, '.modules-'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const options = {
  namespace: 'https://shop.example/capabilities',
  owner: { id: 'shop', name: 'Shop' },
}
const MODULE = `import { defineCapability, defineResource } from '@affordances/ir'
import { z } from 'zod'
export const plan = defineResource({ id: 'shop.plan', description: 'A plan', key: 'slug', attributes: z.object({ slug: z.string() }) })
export const subscribe = defineCapability({ id: 'shop.plan.subscribe', kind: 'action', description: 'Subscribe', target: plan, authorization: { principal: 'authenticated' } })
`
const ACTIONS =
  "'use server'\nimport { defineAction } from '@affordances/next'\nimport { z } from 'zod'\n"
const V0 = `${ACTIONS}export const addToCart = defineAction({ name: 'addToCart', id: 'shop.cart.add', description: 'Add it', expose: 'public', input: z.object({ slug: z.string() }), run: async () => {} })\n`
const BOUND = `${ACTIONS}import { subscribe } from '../capabilities'\nexport const sub = defineAction({ capability: subscribe, name: 'subscribe', run: async () => {} })\n`

test('modules and extraction merge into one valid manifest, with bindings for both', async () => {
  const dir = app({
    'app/capabilities.ts': MODULE,
    'app/products/[slug]/actions.ts': V0,
    'app/plans/actions.ts': BOUND,
  })
  const r = await compile(dir, options)
  expect(r.diagnostics.filter((d) => d.code.startsWith('E_'))).toEqual([])
  expect(r.failed).toBe(false)
  expect(r.manifest!.capabilities.map((c) => c.id)).toEqual([
    'shop.cart.add',
    'shop.plan.subscribe',
  ])
  expect(r.manifest!.resources!.map((x) => x.id)).toEqual(['products', 'shop.plan'])
  expect(r.manifest!.sources!.map((s) => s.id)).toContain('affordances-next')
  expect(r.manifest!.bindings!.map((b) => [b.capability, b.address])).toEqual([
    ['shop.cart.add', { route: '/products/[slug]', action: 'addToCart' }],
    ['shop.plan.subscribe', { route: '/plans', action: 'subscribe' }],
  ])
  expect(r.digest).toMatch(/^sha256-/)
  // the extracted capability keeps its provenance, which names the extractor's source
  expect(
    (
      r.manifest!.capabilities.find((c) => c.id === 'shop.cart.add')!.fieldProvenance as Record<
        string,
        unknown
      >
    )['/id'],
  ).toMatchObject({
    source: 'affordances-next',
    basis: 'imported',
  })
}, 120_000)

test('the outputs are written once, byte for byte the same on a second compile, and touched only when they change', async () => {
  const dir = app({
    'app/capabilities.ts': MODULE,
    'app/products/[slug]/actions.ts': V0,
    'app/plans/actions.ts': BOUND,
  })
  writeCompiled(dir, await compile(dir, options))
  const files = ['manifest.json', 'bindings.ts', 'diagnostics.json'].map((f) =>
    path.join(dir, '.affordances', f),
  )
  const before = files.map((f) => [readFileSync(f, 'utf8'), statSync(f).mtimeMs])
  writeCompiled(dir, await compile(dir, options))
  expect(files.map((f) => [readFileSync(f, 'utf8'), statSync(f).mtimeMs])).toEqual(before)
  const bindings = readFileSync(files[1]!, 'utf8')
  expect(bindings).toContain('import * as a0 from "../app/plans/actions"')
  expect(bindings).toContain('import * as a1 from "../app/products/[slug]/actions"')
  expect(bindings).toContain('"shop.cart.add": { action: a1.addToCart, route: "/products/[slug]"')
  expect(bindings).toContain('"shop.plan.subscribe": { action: a0.sub, route: "/plans"')
  expect(JSON.parse(readFileSync(files[0]!, 'utf8')).namespace).toBe(options.namespace)
}, 120_000)

test('an extracted id a module already defines is E_CAPABILITY_DUPLICATE, and fails the build', async () => {
  const dir = app({
    'app/capabilities.ts': MODULE,
    'app/plans/actions.ts': `${ACTIONS}export const sub = defineAction({ name: 'sub', id: 'shop.plan.subscribe', description: 'Again', input: z.object({}), run: async () => {} })\n`,
  })
  const r = await compile(dir, options)
  expect(r.diagnostics.find((d) => d.code === 'E_CAPABILITY_DUPLICATE')).toMatchObject({
    subject: 'shop.plan.subscribe',
  })
  expect([r.failed, r.manifest]).toEqual([true, undefined])
}, 120_000)

test('a bound action that also sets a field its capability defines is E_BOUND_REDEFINES', async () => {
  const dir = app({
    'app/capabilities.ts': MODULE,
    'app/plans/actions.ts': `${ACTIONS}import { subscribe } from '../capabilities'\nexport const sub = defineAction({ capability: subscribe, name: 'subscribe', description: 'Mine', expose: 'session', run: async () => {} })\n`,
  })
  const r = await compile(dir, options)
  expect(r.diagnostics.filter((d) => d.code === 'E_BOUND_REDEFINES').map((d) => d.detail)).toEqual([
    "description redefines the capability's description",
    "expose redefines the capability's authorization",
  ])
  expect(r.failed).toBe(true)
}, 120_000)

test('a module that imports app code stops the pipeline before anything is evaluated', async () => {
  const dir = app({
    'app/lib.ts': "throw new Error('evaluated')\n",
    'app/capabilities.ts': "import '../app/lib'\nexport {}\n",
  })
  const r = await compile(dir, options)
  expect(r.diagnostics.map((d) => d.code)).toEqual(['E_CAPABILITY_IMPORT'])
  expect(r.failed).toBe(true)
}, 120_000)

test('with no namespace, nothing but diagnostics is written, and W_NO_NAMESPACE isn’t repeated', async () => {
  const dir = app({ 'app/capabilities.ts': MODULE, 'app/products/[slug]/actions.ts': V0 })
  const r = await compile(dir, {})
  writeCompiled(dir, r)
  expect(existsSync(path.join(dir, '.affordances', 'manifest.json'))).toBe(false)
  expect(r.diagnostics.map((d) => d.code)).not.toContain('W_NO_NAMESPACE')
}, 120_000)

// intake (2026-11-18): @affordances/ir is next's optional peer, resolved from the app's root. These apps sit outside
// this repo, so ir doesn't resolve from them, as in an app that never installed it
const outside = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'affordances-no-ir-'))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

test('a v0 app, with no capability modules and no namespace, works as today: nothing loads and nothing is written', async () => {
  const dir = outside({ 'package.json': '{}', 'app/products/[slug]/actions.ts': V0 })
  try {
    const r = await compile(dir, {})
    expect(r).toEqual({ bindings: [], diagnostics: [], failed: false })
    writeCompiled(dir, r)
    expect(existsSync(path.join(dir, '.affordances', 'manifest.json'))).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('capability modules, or a namespace, without a resolvable ir: one E_IR_MISSING naming the peer, never a crash', async () => {
  for (const [files, opts] of [
    [{ 'package.json': '{}', 'app/capabilities.ts': MODULE }, options],
    [{ 'package.json': '{}', 'app/products/[slug]/actions.ts': V0 }, options],
  ] as const) {
    const dir = outside(files)
    try {
      const r = await compile(dir, opts)
      expect(r.diagnostics.map((d) => [d.code, d.subject])).toEqual([
        ['E_IR_MISSING', '@affordances/ir'],
      ])
      expect([r.failed, r.manifest]).toEqual([true, undefined])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
