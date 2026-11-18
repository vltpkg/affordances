import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { compileSync, writeCompiled, type Compiled } from '../src/compile.ts'

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

type M = {
  namespace: string
  capabilities: { id: string; fieldProvenance?: Record<string, unknown> }[]
  resources?: { id: string }[]
  sources?: { id: string }[]
  bindings?: { capability: string; address: unknown }[]
}
// the manifest as manifest.json holds it
const manifestOf = (r: Compiled) => JSON.parse(r.canonical!) as M

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
  const r = compileSync(dir, options)
  expect(r.diagnostics.filter((d) => d.code.startsWith('E_'))).toEqual([])
  expect(r.failed).toBe(false)
  expect(manifestOf(r).capabilities.map((c) => c.id)).toEqual([
    'shop.cart.add',
    'shop.plan.subscribe',
  ])
  expect(manifestOf(r).resources!.map((x) => x.id)).toEqual(['products', 'shop.plan'])
  expect(manifestOf(r).sources!.map((s) => s.id)).toContain('affordances-next')
  expect(manifestOf(r).bindings!.map((b) => [b.capability, b.address])).toEqual([
    ['shop.cart.add', { route: '/products/[slug]', action: 'addToCart' }],
    ['shop.plan.subscribe', { route: '/plans', action: 'subscribe' }],
  ])
  expect(r.digest).toMatch(/^sha256-/)
  // the extracted capability keeps its provenance, which names the extractor's source
  expect(
    (
      manifestOf(r).capabilities.find((c) => c.id === 'shop.cart.add')!.fieldProvenance as Record<
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
  writeCompiled(dir, compileSync(dir, options))
  const files = ['manifest.json', 'bindings.ts', 'diagnostics.json'].map((f) =>
    path.join(dir, '.affordances', f),
  )
  const before = files.map((f) => [readFileSync(f, 'utf8'), statSync(f).mtimeMs])
  writeCompiled(dir, compileSync(dir, options))
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
  const r = compileSync(dir, options)
  expect(r.diagnostics.find((d) => d.code === 'E_CAPABILITY_DUPLICATE')).toMatchObject({
    subject: 'shop.plan.subscribe',
  })
  expect([r.failed, r.canonical]).toEqual([true, undefined])
}, 120_000)

test('a bound action that also sets a field its capability defines is E_BOUND_REDEFINES', async () => {
  const dir = app({
    'app/capabilities.ts': MODULE,
    'app/plans/actions.ts': `${ACTIONS}import { subscribe } from '../capabilities'\nexport const sub = defineAction({ capability: subscribe, name: 'subscribe', description: 'Mine', expose: 'session', run: async () => {} })\n`,
  })
  const r = compileSync(dir, options)
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
  const r = compileSync(dir, options)
  expect(r.diagnostics.map((d) => d.code)).toEqual(['E_CAPABILITY_IMPORT'])
  expect(r.failed).toBe(true)
}, 120_000)

test('with no namespace, nothing but diagnostics is written, and W_NO_NAMESPACE isn’t repeated', async () => {
  const dir = app({ 'app/capabilities.ts': MODULE, 'app/products/[slug]/actions.ts': V0 })
  const r = compileSync(dir, {})
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
    const r = compileSync(dir, {})
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
      const r = compileSync(dir, opts)
      expect(r.diagnostics.map((d) => [d.code, d.subject])).toEqual([
        ['E_IR_MISSING', '@affordances/ir'],
      ])
      expect([r.failed, r.canonical]).toEqual([true, undefined])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

// review of 917a50b6: the walk's own errors are reported even when the peer is missing
test('a module’s syntax error isn’t hidden behind a missing peer', async () => {
  const dir = outside({
    'package.json': '{}',
    'app/capabilities.ts': MODULE,
    'app/cart/capabilities.tsx': 'export {}\n',
  })
  try {
    expect(compileSync(dir, options).diagnostics.map((d) => d.code)).toEqual([
      'E_CAPABILITY_SYNTAX',
      'E_IR_MISSING',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// compileSync is synchronous, for withAffordances, and the build's own process never loads ir: only the evaluator's
// sandboxed child does. Checked in a fresh process whose load hook records any module loaded from ir's package
test('compileSync never loads @affordances/ir in the process that calls it', () => {
  const dir = app({ 'app/capabilities.ts': MODULE, 'app/products/[slug]/actions.ts': V0 })
  const script = [
    "import { registerHooks } from 'node:module'",
    "import { realpathSync } from 'node:fs'",
    "import path from 'node:path'",
    "import { createRequire } from 'node:module'",
    // ir's real package dir, where the app resolves it: finding it is fine (resolveIr does); loading from it isn't
    `const irDir = path.dirname(realpathSync(createRequire(${JSON.stringify(path.join(dir, 'package.json'))}).resolve('@affordances/ir')))`,
    'const asked = []',
    'registerHooks({ load(url, c, next) { if (url.startsWith("file://") && realpathSync(new URL(url)).startsWith(irDir)) asked.push(url); return next(url, c) } })',
    `const { compileSync, writeCompiled } = await import(${JSON.stringify(path.join(import.meta.dirname, '..', 'src', 'compile.ts'))})`,
    `const r = compileSync(${JSON.stringify(dir)}, ${JSON.stringify(options)})`,
    `writeCompiled(${JSON.stringify(dir)}, r)`,
    'console.log(JSON.stringify({ asked, failed: r.failed, written: !!r.canonical }))',
  ].join('\n')
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  })
  expect(JSON.parse(child.stdout.trim().split('\n').at(-1)!)).toEqual({
    asked: [],
    failed: false,
    written: true,
  })
  expect(existsSync(path.join(dir, '.affordances', 'manifest.json'))).toBe(true)
}, 120_000)

// a bound action's capability, however it's imported (the planner, 2026-11-18, from hosting-lab's real build): a
// rename, a tsconfig alias, both, a namespace import, and a re-export through another capabilities.ts
test('a bound action’s capability resolves through a rename, an alias, a namespace import and a re-export', async () => {
  const forms: Record<string, string> = {
    renamed:
      "import { subscribe as sub } from '../capabilities'\nexport const a = defineAction({ capability: sub, name: 'a', run: async () => {} })",
    aliased:
      "import { subscribe } from '@/app/capabilities'\nexport const a = defineAction({ capability: subscribe, name: 'a', run: async () => {} })",
    'aliased-renamed':
      "import { subscribe as subscribeCapability } from '@/app/capabilities'\nexport const a = defineAction({ capability: subscribeCapability, name: 'a', run: async () => {} })",
    namespace:
      "import * as caps from '../capabilities'\nexport const a = defineAction({ capability: caps.subscribe, name: 'a', run: async () => {} })",
    reexported:
      "import { subscribe } from './capabilities'\nexport const a = defineAction({ capability: subscribe, name: 'a', run: async () => {} })",
  }
  for (const [form, body] of Object.entries(forms)) {
    const dir = app({
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
      'app/capabilities.ts': MODULE,
      [`app/${form}/actions.ts`]: `${ACTIONS}${body}\n`,
      // the re-export: a capabilities.ts of its own that passes another module's capability on
      ...(form === 'reexported' && {
        [`app/${form}/capabilities.ts`]: "export { subscribe } from '../capabilities'\n",
      }),
    })
    const r = compileSync(dir, options)
    expect({ form, errors: r.diagnostics.filter((d) => d.code.startsWith('E_')) }).toEqual({
      form,
      errors: [],
    })
    expect({ form, bound: r.bindings.map((b) => [b.capability, b.address.route]) }).toEqual({
      form,
      bound: [['shop.plan.subscribe', `/${form}`]],
    })
  }
}, 300_000)

test('a bound action whose capability isn’t a capabilities.ts export is E_BOUND_UNRESOLVED, not an import error', async () => {
  const dir = app({
    'app/capabilities.ts': MODULE,
    'app/lib.ts': 'export const notACapability = {}\n',
    'app/plans/actions.ts': `${ACTIONS}import { notACapability } from '../lib'\nexport const a = defineAction({ capability: notACapability, name: 'a', run: async () => {} })\n`,
  })
  const r = compileSync(dir, options)
  expect(
    r.diagnostics.filter((d) => d.code.startsWith('E_')).map((d) => [d.code, d.subject]),
  ).toEqual([['E_BOUND_UNRESOLVED', 'a']])
  expect(r.failed).toBe(true)
}, 120_000)

test('a bound action keeps v0’s effects, its delta keys, without redefining the capability’s effects', async () => {
  // the capability declares effects of its own, so the old effects-to-effects rule would have fired here
  const withEffects = MODULE.replace(
    "authorization: { principal: 'authenticated' } })",
    "authorization: { principal: 'authenticated' }, effects: [{ category: 'state', change: 'update', resource: plan, description: 'Subscribes', reversibility: 'reversible' }] })",
  )
  expect(withEffects).not.toBe(MODULE)
  const dir = app({
    'app/capabilities.ts': withEffects,
    'app/plans/actions.ts': `${ACTIONS}import { subscribe } from '../capabilities'\nexport const a = defineAction({ capability: subscribe, name: 'a', effects: ['plans'], run: async () => {} })\n`,
  })
  const r = compileSync(dir, options)
  expect(r.diagnostics.filter((d) => d.code.startsWith('E_'))).toEqual([])
  expect(r.bindings.map((b) => b.capability)).toEqual(['shop.plan.subscribe'])
}, 120_000)

test('an unreadable tsconfig is W_TSCONFIG_UNREADABLE, never a silent loss of every alias, and fails in strict mode', async () => {
  const dir = app({ 'tsconfig.json': '{ "compilerOptions": { ', 'app/capabilities.ts': MODULE })
  const codes = (strict: boolean) => {
    const r = compileSync(dir, { ...options, strict })
    return {
      failed: r.failed,
      unreadable: r.diagnostics
        .filter((d) => d.code === 'W_TSCONFIG_UNREADABLE')
        .map((d) => d.file),
    }
  }
  expect(codes(false)).toEqual({ failed: false, unreadable: ['tsconfig.json'] })
  expect(codes(true)).toEqual({ failed: true, unreadable: ['tsconfig.json'] })
}, 120_000)
