import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { findInputs, MAX_DEPTH, sliceInput, type SliceResult } from '../src/slice.ts'

// RFC 0005 §2.1's E3 slice, under intake's binding notes (2026-11-18): every schema file either converts or is opaque
// with its reason, none crashes, and no app code is ever evaluated. A sentinel module records any import of it, and
// the last test checks no test above tripped it

let root: string

beforeAll(() => {
  // inside the package, so 'zod' resolves from its node_modules
  root = mkdtempSync(path.join(import.meta.dirname, '.slice-'))
  mkdirSync(path.join(root, 'lib'))
  mkdirSync(path.join(root, 'app'))
  // the sentinel: app code. Importing it, ever, leaves a marker and throws
  writeFileSync(
    path.join(root, 'lib', 'sentinel.ts'),
    [
      "import { writeFileSync } from 'node:fs'",
      "writeFileSync(new URL('./SENTINEL-HIT', import.meta.url), 'imported')",
      "throw new Error('SENTINEL: app code was evaluated')",
      'export type Order = { id: string }',
      'export function makeSchema() { return 1 }',
    ].join('\n'),
  )
  // app code a schema might reach for: a value made by a call on app code
  writeFileSync(
    path.join(root, 'lib', 'db.ts'),
    "import { makeSchema } from './sentinel'\nexport const db = makeSchema()\n",
  )
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
// one actions file with one action, whose input is `input`, after `preamble`; plus any helper modules
const slice = (
  preamble: string,
  input: string,
  helpers: Record<string, string> = {},
  strict = false,
) => {
  const dir = path.join(root, 'app', `case${n++}`)
  mkdirSync(dir)
  for (const [name, text] of Object.entries(helpers)) writeFileSync(path.join(dir, name), text)
  const file = path.join(dir, 'actions.ts')
  const source = `'use server'\nimport { defineAction } from '@affordances/next'\n${preamble}\nexport const act = defineAction({ name: 'act', input: ${input}, run: async () => {} })\n`
  writeFileSync(file, source)
  const [found] = findInputs(file, source)
  return sliceInput(root, file, source, found!.input as never, { strict })
}

// a result, as one comparable value: its status, what it dropped and its top-level fields, or its reason
const summary = (r: SliceResult) =>
  r.status === 'converted'
    ? {
        status: r.status,
        lossy: r.lossy,
        type: r.schema.type,
        fields: Object.keys((r.schema.properties ?? {}) as object).toSorted(),
      }
    : { status: r.status, reason: r.reason }
const schemaOf = (r: SliceResult) => (r.status === 'converted' ? r.schema : undefined)
const CONVERTED = { status: 'converted', lossy: [] }
const opaque = (reason: RegExp) => ({ status: 'opaque', reason: expect.stringMatching(reason) })
const Z = "import { z } from 'zod'"

// a chain of modules, each re-exporting the next, the last defining S
const chain = (depth: number) => {
  const helpers: Record<string, string> = {}
  for (let d = 1; d <= depth; d++)
    helpers[`s${d}.ts`] =
      d === depth
        ? `${Z}\nexport const S = z.object({ a: z.string() })\n`
        : `export { S } from './s${d + 1}'\n`
  return helpers
}

test('an inline schema converts to JSON Schema', () => {
  const r = slice(Z, 'z.object({ a: z.string() })')
  expect(summary(r)).toEqual({ status: 'converted', lossy: [], type: 'object', fields: ['a'] })
  expect(schemaOf(r)).toMatchObject({ properties: { a: { type: 'string' } } })
  expect(schemaOf(r)).not.toHaveProperty('$schema')
})

test('consts follow, and a function parameter shadows a top-level let of the same name', () => {
  expect(
    summary(slice(`${Z}\nconst A = z.string()\nconst B = z.object({ a: A })`, 'B')),
  ).toMatchObject(CONVERTED)
  expect(
    summary(slice(`${Z}\nlet s = 1`, 'z.object({ a: ((s: number) => z.number().min(s))(1) })')),
  ).toMatchObject(CONVERTED)
})

test('a recursive schema, through lazy, converts', () => {
  const r = slice(
    `${Z}\nconst Node: z.ZodType<unknown> = z.lazy(() => z.object({ children: z.array(Node) }))`,
    'z.object({ root: Node })',
  )
  expect(summary(r)).toMatchObject(CONVERTED)
  expect(JSON.stringify(schemaOf(r))).toContain('children')
})

test('imports follow into other modules to a depth of 4, and refuse beyond it', () => {
  expect(MAX_DEPTH).toBe(4)
  expect(summary(slice("import { S } from './s1'", 'S', chain(4)))).toMatchObject(CONVERTED)
  expect(summary(slice("import { S } from './s1'", 'S', chain(5)))).toMatchObject(
    opaque(/beyond a depth of 4/),
  )
})

test('a type-only import, even of app code, is erased', () => {
  expect(
    summary(
      slice(
        `${Z}\nimport type { Order } from '../../lib/sentinel'\nconst O: z.ZodType<Order> = z.object({ id: z.string() })`,
        'O',
      ),
    ),
  ).toMatchObject(CONVERTED)
})

test('a const sliced out of an app module runs on its own: the module’s side-effect imports never run', () => {
  const helpers = {
    'schemas.ts': `${Z}\nimport '../../lib/sentinel'\nexport const S = z.object({ a: z.string() })\n`,
  }
  expect(summary(slice("import { S } from './schemas'", 'S', helpers))).toMatchObject(CONVERTED)
})

test('app code, a let, a function, ambient reads and other packages make the input opaque', () => {
  const cases: [string, string, RegExp, Record<string, string>?][] = [
    [`${Z}\nimport { db } from '../../lib/db'`, 'z.object({ a: db })', /makeSchema is a function/],
    [`${Z}\nlet S = z.string()`, 'S', /is a let/],
    [`${Z}\nfunction f() { return z.string() }`, 'f()', /is a function/],
    [Z, 'z.string().default(process.env.X ?? "")', /reads process/],
    [Z, 'z.number().default(Date.now())', /reads Date/],
    [Z, 'z.number().default(Math.random())', /reads Math/],
    ["import { pick } from 'lodash'", 'pick', /isn't a schema library/],
    [`${Z}\nimport * as s from './s'`, 's.S', /as a namespace/, { 's.ts': 'export const S = 1\n' }],
    [`${Z}\nenum E { A = 'a' }`, 'z.enum(E)', /an enum/],
    [Z, "z.lazy(() => import('./x'))", /dynamic import/],
  ]
  for (const [preamble, input, reason, helpers] of cases)
    expect(summary(slice(preamble, input, helpers))).toMatchObject(opaque(reason))
})

test('a lossy schema converts with each dropped construct named, and is opaque in strict mode', () => {
  expect(
    summary(
      slice(Z, 'z.object({ a: z.string().refine((s) => s.length > 1) }).transform((o) => o)'),
    ),
  ).toMatchObject({ status: 'converted', lossy: ['refine', 'transform'] })
  expect(summary(slice(Z, 'z.preprocess((v) => v, z.string())'))).toMatchObject({
    status: 'converted',
    lossy: ['preprocess'],
  })
  expect(summary(slice(Z, 'z.string().refine((s) => s.length > 1)', {}, true))).toMatchObject(
    opaque(/strict mode: the schema uses refine/),
  )
})

test('what evaluates but isn’t a Standard Schema, or throws, or doesn’t parse, is opaque, never a crash', () => {
  expect(summary(slice('', '{ a: 1 }'))).toMatchObject(opaque(/isn't a Standard Schema/))
  expect(summary(slice(Z, "z.string().regex(new RegExp('('))"))).toMatchObject(
    opaque(/evaluation failed/),
  )
  expect(
    summary(slice("import { S } from './bad'", 'S', { 'bad.ts': 'export const S = (\n' })),
  ).toMatchObject(opaque(/doesn't parse/))
})

// the generated corpus: schema files built from parts whose outcome is known by construction, so each file's result
// is checked against what it must be, not just against not crashing
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

type Part = {
  preamble: string[]
  field: string
  helpers?: Record<string, string>
  opaque?: true
  lossy?: string
}
const LEAVES = [
  'z.string()',
  'z.number().int()',
  'z.boolean()',
  "z.enum(['a', 'b'])",
  'z.array(z.string())',
  'z.string().optional()',
]
const parts = (r: () => number, k: number): Part => {
  const leaf = LEAVES[Math.floor(r() * LEAVES.length)]!
  switch (Math.floor(r() * 9)) {
    case 0:
      return { preamble: [], field: leaf }
    case 1:
      return { preamble: [`const C${k} = ${leaf}`], field: `C${k}` }
    case 2: {
      const depth = 1 + Math.floor(r() * 5)
      const helpers: Record<string, string> = {}
      for (let d = 1; d <= depth; d++)
        helpers[`h${k}_${d}.ts`] =
          d === depth
            ? `${Z}\nexport const H${k} = ${leaf}\n`
            : `export { H${k} } from './h${k}_${d + 1}'\n`
      return {
        preamble: [`import { H${k} } from './h${k}_1'`],
        field: `H${k}`,
        helpers,
        ...(depth > MAX_DEPTH && { opaque: true as const }),
      }
    }
    case 3:
      return {
        preamble: [`const L${k}: z.ZodType<unknown> = z.lazy(() => z.array(L${k}))`],
        field: `L${k}`,
      }
    case 4:
      return { preamble: [], field: `${leaf}.refine(() => true)`, lossy: 'refine' }
    case 5:
      return { preamble: [`let V${k} = ${leaf}`], field: `V${k}`, opaque: true }
    case 6:
      return {
        preamble: [`import { db as D${k} } from '../../lib/db'`],
        field: `z.object({}).default(D${k})`,
        opaque: true,
      }
    case 7:
      return { preamble: [], field: `z.string().default(String(Math.random()))`, opaque: true }
    default:
      return {
        preamble: ["import type { Order } from '../../lib/sentinel'"],
        field: `(${leaf} as z.ZodType<unknown>)`,
      }
  }
}

test('a generated corpus of 120 schema files: each converts or is opaque exactly as built, and none crashes', () => {
  const r = rng(20261118)
  const outcomes: string[] = []
  for (let i = 0; i < 120; i++) {
    const ps = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, k) => parts(r, k))
    const preamble = [Z, ...new Set(ps.flatMap((p) => p.preamble))].join('\n')
    const input = `z.object({ ${ps.map((p, k) => `f${k}: ${p.field}`).join(', ')} })`
    const helpers = Object.assign({}, ...ps.map((p) => p.helpers ?? {}))
    const lossy = [...new Set(ps.flatMap((p) => (p.lossy ? [p.lossy] : [])))].toSorted()
    const expected = ps.some((p) => p.opaque)
      ? { status: 'opaque' }
      : { status: 'converted', lossy, type: 'object', fields: ps.map((_, k) => `f${k}`).toSorted() }
    const actual = summary(slice(preamble, input, helpers))
    expect({ i, input, ...actual }).toMatchObject({ i, input, ...expected })
    outcomes.push(actual.status === 'converted' && lossy.length ? 'lossy' : actual.status)
  }
  // the corpus exercises every outcome
  const count = (o: string) => outcomes.filter((x) => x === o).length
  expect([count('converted') > 10, count('lossy') > 5, count('opaque') > 10]).toEqual([
    true,
    true,
    true,
  ])
}, 300_000)

test('the sentinel was never imported, by any test above', () => {
  expect(existsSync(path.join(root, 'lib', 'SENTINEL-HIT'))).toBe(false)
})
