import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, expect, test } from 'vitest'

// intake's ruling (2026-11-18): @affordances/ir is next's optional peer and zod is only ir's, so next's published dist
// bundles neither, and the evaluator reaches ir by a bare import the app resolves. This builds next for real (its dist
// is build output, git-ignored) and reads what came out

const pkg = path.join(import.meta.dirname, '..')
const dist = path.join(pkg, 'dist')
const read = (f: string) => readFileSync(path.join(dist, f), 'utf8')
let js: string[] = []
let dts: string[] = []

beforeAll(() => {
  // the workspace's own tsdown, as `vlt run build` runs it
  execFileSync(path.join(pkg, '..', '..', 'node_modules', '.bin', 'tsdown'), [], {
    cwd: pkg,
    stdio: 'ignore',
  })
  js = readdirSync(dist).filter((f) => f.endsWith('.js'))
  dts = readdirSync(dist).filter((f) => f.endsWith('.d.ts'))
}, 120_000)

// strings that only ir's or zod's own code holds: ir's brand key, a validate message, a code, fromModules' definition;
// zod's base type and error class
const IR_CODE = [
  /affordances\.defined/,
  /needs evidence/,
  /E_DUPLICATE_ID/,
  /(const|function) fromModules\b/,
]
const ZOD_CODE = [/\$ZodType/, /class ZodError/, /ZodError\b.*extends/]

test('no file in next’s dist holds ir’s code or zod’s', () => {
  expect(js.length).toBeGreaterThan(5)
  const found = js.flatMap((f) =>
    [...IR_CODE, ...ZOD_CODE].filter((re) => re.test(read(f))).map((re) => `${f}: ${re.source}`),
  )
  expect(found).toEqual([])
})

test('the evaluator reaches ir by a bare import, which the app resolves, and nothing imports zod', () => {
  expect(read('evaluate.js')).toMatch(/import\(["']@affordances\/ir["']\)/)
  const zodImports = js.filter((f) => /from ["']zod["']|import\(["']zod["']\)/.test(read(f)))
  expect(zodImports).toEqual([])
})

// an import or import type, or an inline import() type; prose naming the package (a diagnostic's text) isn't one
const refersToIr = /from ["']@affordances\/ir["'/]|import\(["']@affordances\/ir["'/]/

const refersToRuntime = /from ["']@affordances\/runtime["'/]|import\(["']@affordances\/runtime["'/]/

test('only /projection refers to runtime, the second optional peer, by import, never bundling it; no other entry at all', () => {
  // intake (2026-11-18): @affordances/runtime is next's second optional peer, imported only by /projection as a bare
  // import the app resolves; its values on the first request, its types in the declarations
  expect(read('projection.js')).toMatch(/import\(["']@affordances\/runtime["']\)/)
  expect(read('projection.js')).not.toMatch(
    /(const|function) createRuntime\b|(const|function) statusOf\b/,
  )
  expect(read('projection.d.ts')).toMatch(refersToRuntime)
  const others = [...js, ...dts].filter((f) => !['projection.js', 'projection.d.ts'].includes(f))
  expect(others.length).toBeGreaterThan(5)
  expect(others.filter((f) => refersToRuntime.test(read(f)))).toEqual([])
})

test('only /author refers to ir, in code and declarations; the evaluator only by its bare import; no other entry at all', () => {
  // intake (2026-11-18): next/author re-exports the authoring API from the optional peer, the one entry that may
  // reference ir
  expect(read('author.js')).toMatch(refersToIr)
  expect(read('author.d.ts')).toMatch(refersToIr)
  // the evaluator's child imports ir, but only by a dynamic, bare import the app resolves, never a static one
  expect(read('evaluate.js')).not.toMatch(/from ["']@affordances\/ir["'/]/)
  const others = [...js, ...dts].filter(
    (f) => !['author.js', 'author.d.ts', 'evaluate.js'].includes(f),
  )
  expect(others.length).toBeGreaterThan(5)
  expect(others.filter((f) => refersToIr.test(read(f)))).toEqual([])
})

test("/author is a re-export only: it holds none of ir's code, and names only the authoring API", () => {
  const text = read('author.js')
  expect(IR_CODE.filter((re) => re.test(text))).toEqual([])
  // the app-facing API, not the compiler's internals
  for (const internal of ['fromModules', 'MODULE_CODES', 'brandOf', 'assemble'])
    expect(text).not.toContain(internal)
  expect(text).toContain('defineCapability')
})

test('package.json: ir and runtime are optional peers and no dependency; zod is in no dependency, peer or optional field', () => {
  const p = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')) as Record<
    string,
    Record<string, unknown> | undefined
  >
  expect(p.peerDependencies?.['@affordances/ir']).toBeDefined()
  expect(p.peerDependenciesMeta?.['@affordances/ir']).toEqual({ optional: true })
  expect(p.dependencies?.['@affordances/ir']).toBeUndefined()
  // runtime, likewise: an optional peer, never a dependency
  expect(p.peerDependencies?.['@affordances/runtime']).toBeDefined()
  expect(p.peerDependenciesMeta?.['@affordances/runtime']).toEqual({ optional: true })
  expect(p.dependencies?.['@affordances/runtime']).toBeUndefined()
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'])
    expect({ field, zod: p[field]?.zod }).toEqual({ field, zod: undefined })
})
