import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { evaluateModules } from '../src/evaluator.ts'

// RFC 0005 §1's evaluation: the capability modules run in a fresh child, twice, with an empty environment, under Node's
// permission model, and fromModules makes one manifest of their exports

let root: string
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}
const identity = {
  namespace: 'https://shop.example/capabilities',
  owner: { id: 'shop', name: 'Shop' },
}
const IR =
  "import { defineCapability, defineResource } from '@affordances/ir'\nimport { z } from 'zod'\n"

let n = 0
// an app of its own per case, so each evaluation reads only what it's given
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
  write('.env', 'SECRET=1\n')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const PLAN = `${IR}export const plan = defineResource({ id: 'shop.plan', description: 'A plan', key: 'slug', attributes: z.object({ slug: z.string() }) })\n`

test('two modules, one importing the other without an extension and one through an alias, make one manifest', () => {
  const dir = app({
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./app/*"] } } }',
    'app/capabilities.ts': PLAN,
    'app/plans/capabilities.ts': `${IR}import { plan } from '../capabilities'\nexport const subscribe = defineCapability({ id: 'shop.plan.subscribe', kind: 'action', description: 'Subscribe', target: plan, authorization: { principal: 'authenticated' } })\n`,
    'app/cancel/capabilities.ts': `${IR}import { plan } from '@/capabilities'\nexport const cancel = defineCapability({ id: 'shop.plan.cancel', kind: 'action', description: 'Cancel', target: plan, authorization: { principal: 'authenticated' } })\n`,
  })
  const modules = [
    'app/capabilities.ts',
    'app/plans/capabilities.ts',
    'app/cancel/capabilities.ts',
  ].map((m) => path.join(dir, m))
  const r = evaluateModules(dir, modules, identity)
  expect(r.diagnostics.filter((d) => d.code.startsWith('E_'))).toEqual([])
  const manifest = JSON.parse(r.manifest!) as {
    namespace: string
    capabilities: { id: string }[]
    resources: { id: string }[]
  }
  expect(manifest.namespace).toBe(identity.namespace)
  expect(manifest.capabilities.map((c) => c.id)).toEqual([
    'shop.plan.cancel',
    'shop.plan.subscribe',
  ])
  expect(manifest.resources.map((x) => x.id)).toEqual(['shop.plan'])
}, 60_000)

test('with no namespace, the reason is no-namespace and there is no manifest', () => {
  const dir = app({ 'app/capabilities.ts': PLAN })
  const r = evaluateModules(dir, [path.join(dir, 'app/capabilities.ts')], {})
  expect(r).toMatchObject({ reason: 'no-namespace' })
  expect(r.manifest).toBeUndefined()
}, 60_000)

test('a module that throws is E_CAPABILITY_EVALUATION, naming it, never a crash of the build', () => {
  const dir = app({ 'app/capabilities.ts': "throw new Error('boom at import')\n" })
  const r = evaluateModules(dir, [path.join(dir, 'app/capabilities.ts')], identity)
  expect(r.diagnostics).toEqual([
    { code: 'E_CAPABILITY_EVALUATION', file: 'app/capabilities.ts', detail: 'boom at import' },
  ])
}, 60_000)

test('a manifest that differs between the two evaluations is E_CAPABILITY_NONDETERMINISTIC, showing where', () => {
  // the static check refuses Math.random first in the pipeline; here it stands for what that check can miss
  const dir = app({
    'app/capabilities.ts': `${IR}export const plan = defineResource({ id: 'shop.plan', description: 'A plan ' + Math.random(), key: 'slug' })\n`,
  })
  const r = evaluateModules(dir, [path.join(dir, 'app/capabilities.ts')], identity)
  expect(r.manifest).toBeUndefined()
  expect(r.diagnostics.map((d) => d.code)).toEqual(['E_CAPABILITY_NONDETERMINISTIC'])
  expect(r.diagnostics[0]!.detail).toMatch(/first differ at byte \d+: …/)
}, 60_000)

test('the child can’t read the root’s .env, write a file, or fetch: each is an evaluation error, never a value', () => {
  const env = path.join(root, '.env')
  const cases = [
    `import { readFileSync } from 'node:fs'\nexport const x = readFileSync(${JSON.stringify(env)}, 'utf8')\n`,
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./written', import.meta.url), 'x')\n`,
    "await fetch('http://127.0.0.1:8080/')\n",
  ]
  for (const text of cases) {
    const dir = app({ 'app/capabilities.ts': text })
    const r = evaluateModules(dir, [path.join(dir, 'app/capabilities.ts')], identity)
    expect({
      text,
      codes: r.diagnostics.map((d) => d.code),
      detail: r.diagnostics[0]?.detail,
    }).toMatchObject({
      codes: ['E_CAPABILITY_EVALUATION'],
      detail: expect.stringMatching(/ERR_ACCESS_DENIED|Access to this API has been restricted/),
    })
  }
}, 120_000)
