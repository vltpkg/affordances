import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  childArgs,
  findInputs,
  MAX_DEPTH,
  planSlice,
  sliceInput,
  sliceInputs,
  type SliceResult,
} from '../src/slice.ts'

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
  return sliceInput(root, file, source, request(file, source).input, { strict })
}
// the file's one action input, as the extract run asks for it
const request = (file: string, source: string) => ({
  file,
  source,
  input: findInputs(file, source)[0]!.input as never,
})
// the same case written, without evaluating it
const written = (preamble: string, input: string, helpers: Record<string, string> = {}) => {
  const dir = path.join(root, 'app', `case${n++}`)
  mkdirSync(dir)
  for (const [name, text] of Object.entries(helpers)) writeFileSync(path.join(dir, name), text)
  const file = path.join(dir, 'actions.ts')
  const source = `'use server'\nimport { defineAction } from '@affordances/next'\n${preamble}\nexport const act = defineAction({ name: 'act', input: ${input}, run: async () => {} })\n`
  writeFileSync(file, source)
  return request(file, source)
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

// review's boundary #2 (2026-11-18): a destructured const binds several names to one declarator, emitted once
test('a destructured const converts, its declarator written once', () => {
  expect(summary(slice(`${Z}\nconst { string, object } = z`, 'object({ a: string() })'))).toEqual({
    status: 'converted',
    lossy: [],
    type: 'object',
    fields: ['a'],
  })
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

// review of aef81dc1: two ways past the rule, both closed
test('a default or computed key inside a binding pattern is read as the initializer is', () => {
  const cases: [string, string, RegExp][] = [
    [`${Z}\nconst { max = Date.now() } = {}`, 'z.number().max(max)', /reads Date/],
    [`${Z}\nconst [first = Math.random()] = []`, 'z.number().default(first)', /reads Math/],
    [Z, 'z.string().default((({ a = process.env.X } = {}) => a ?? "")())', /reads process/],
    [Z, 'z.string().default((({ a: { b = Date.now() } = {} }) => String(b))({}))', /reads Date/],
  ]
  for (const [preamble, input, reason] of cases)
    expect(summary(slice(preamble, input))).toMatchObject(opaque(reason))
})

test('the language’s machinery is out of reach: constructor, __proto__, prototype, and computed keys', () => {
  const cases: [string, RegExp][] = [
    ["z.string().default(Object.constructor('return process')()())", /the constructor property/],
    ['z.string().default(String(({}).__proto__))', /the __proto__ property/],
    ['z.string().default(String(Object.prototype))', /the prototype property/],
    ["z.string().default(String(({})['constr' + 'uctor']))", /a computed key/],
    [
      "z.string().default(String(Object.getOwnPropertyDescriptor(Object, 'keys')))",
      /the getOwnPropertyDescriptor property/,
    ],
  ]
  for (const [input, reason] of cases)
    expect(summary(slice(Z, input))).toMatchObject(opaque(reason))
  // a static key is a name like any other
  expect(
    summary(slice(Z, "z.object({ a: z.string(), 'b-c': z.string(), 1: z.string() })")),
  ).toMatchObject(CONVERTED)
})

// code review of M8 (#3, intake's allowlist, 22:19Z): every key in a slice, in a member expression, an object
// literal or a destructuring pattern, at any depth, is static (an identifier, or a plain string or number literal,
// not computed) and not one of the banned members. Any computed key is refused, whatever it computes to
test.each([
  // review's probes (22:19Z), each converting before
  ['P1, a template member', Z, 'z.string().default(String(Object[`constructor`]))'],
  ['P2, a template member to __proto__', Z, 'z.string().default(String(({})[`__proto__`]))'],
  [
    'P3, a computed string key in a declaration',
    `${Z}\nconst { ['constructor']: F } = Object`,
    'z.string().default(String(F))',
  ],
  [
    'P4, a computed template key in a declaration',
    `${Z}\nconst { [\`constructor\`]: F } = Object`,
    'z.string().default(String(F))',
  ],
  [
    'P5, a computed template key in an assignment',
    Z,
    'z.string().default((() => { let F; ({ [`constructor`]: F } = Object); return String(F) })())',
  ],
  [
    'P6, an escaped identifier key',
    `${Z}\nconst { constructo\\u0072: F } = Object`,
    'z.string().default(String(F))',
  ],
  [
    'P7, a computed string key in a parameter',
    Z,
    "z.string().default((({ ['constructor']: F }) => String(F))(Object))",
  ],
  [
    'P8, a computed __proto__ key in a declaration',
    `${Z}\nconst { ['__proto__']: P } = {}`,
    'z.string().default(String(P))',
  ],
  [
    'P9, a computed string key in an assignment',
    Z,
    "z.string().default((() => { let F; ({ ['constructor']: F } = Object); return String(F) })())",
  ],
  // one per key kind
  ['a computed string member', Z, "z['object']({ a: z.string() })"],
  ['a computed number member', Z, '[z.string()][0]'],
  ['a computed number key in an object literal', Z, 'z.object({ [1]: z.string() })'],
  ['a computed string key in an object literal', Z, "z.object({ ['a']: z.string() })"],
  [
    'a computed key in a nested pattern',
    `${Z}\nconst { a: { ['b']: B } } = { a: { b: z.string() } }`,
    'B',
  ],
  ['a computed key with a default', `${Z}\nconst { ['b']: B = z.string() } = {}`, 'B'],
  ['a computed key beside a rest', `${Z}\nconst { ['b']: B, ...rest } = { b: z.string() }`, 'B'],
  ['a computed number key in a pattern', `${Z}\nconst { [0]: B } = [z.string()]`, 'B'],
] as [string, string, string][])('a computed key is refused: %s', (_, preamble, input) => {
  expect(summary(slice(preamble, input))).toMatchObject(
    opaque(/the constructor property|the __proto__ property|a computed key/),
  )
})

// code review of M8 (#3): a destructuring pattern's key reads the member it names, so it's held to the same rule
test.each([
  ['const { constructor: F } = Object', /the constructor property/],
  ['const { getOwnPropertyDescriptor: F } = Object', /the getOwnPropertyDescriptor property/],
  ["const { 'constructor': F } = Object", /the constructor property/],
  ['const { a: { constructor: F } } = { a: Object }', /the constructor property/],
  ['const { constructor: F = 1 } = Object', /the constructor property/],
  ['const [...[{ constructor: F }]] = [Object]', /the constructor property/],
] as [string, RegExp][])(
  'a destructuring key can’t name the language’s machinery: %s',
  (pattern, reason) => {
    expect(summary(slice(`${Z}\n${pattern}`, 'z.string().default(String(F))'))).toMatchObject(
      opaque(reason),
    )
  },
)

test.each([
  ['a parameter', 'z.string().default((({ constructor: F }) => String(F))(Object))'],
  [
    'a catch clause',
    'z.string().default((() => { try { throw Object } catch ({ constructor: F }) { return String(F) } })())',
  ],
  [
    'an assignment',
    'z.string().default((() => { let F; ({ constructor: F } = Object); return String(F) })())',
  ],
  [
    'a for-of',
    "z.string().default((() => { for (const { constructor: F } of [Object]) return String(F); return '' })())",
  ],
])('a destructuring key can’t name the language’s machinery in %s', (_, input) => {
  expect(summary(slice(Z, input))).toMatchObject(opaque(/the constructor property/))
})

test('the child runs under Node’s permission model: it reads only the slice dir and node_modules, and can’t write or fetch', () => {
  const dir = path.join(root, 'app', 'sandbox')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(root, '.env'), 'SECRET=1\n')
  const args = childArgs(dir)
  expect(args[0]).toBe('--permission')
  expect(args.some((a) => /allow-(fs-write|child-process|net|worker|addons)/.test(a))).toBe(false)
  const attempt = (code: string) =>
    spawnSync(process.execPath, [...args, '--input-type=module', '-e', code], {
      cwd: dir,
      env: {} as NodeJS.ProcessEnv,
      encoding: 'utf8',
    })
  const denied = (r: ReturnType<typeof attempt>) =>
    r.status !== 0 && /ERR_ACCESS_DENIED|permission/i.test(r.stderr + r.stdout)
  const write = attempt(
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(path.join(dir, 'x'))}, 'x')`,
  )
  const env = attempt(
    `import { readFileSync } from 'node:fs'; readFileSync(${JSON.stringify(path.join(root, '.env'))})`,
  )
  // port 8080, since fetch refuses some ports (9) itself, before any permission check
  const net = attempt("await fetch('http://127.0.0.1:8080/')")
  expect([denied(write), denied(env), denied(net)]).toEqual([true, true, true])
  expect(existsSync(path.join(dir, 'x'))).toBe(false)
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

test('one child for a whole run gives each input exactly what its own child does: the corpus, and strict mode', () => {
  const r = rng(20261119)
  const requests = Array.from({ length: 60 }, () => {
    const ps = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, k) => parts(r, k))
    const preamble = [Z, ...new Set(ps.flatMap((p) => p.preamble))].join('\n')
    const input = `z.object({ ${ps.map((p, k) => `f${k}: ${p.field}`).join(', ')} })`
    return written(preamble, input, Object.assign({}, ...ps.map((p) => p.helpers ?? {})))
  })
  // and a schema that throws as it's built, and one that isn't a Standard Schema, each its own error in the batch
  requests.push(written(Z, "z.string().regex(new RegExp('('))"), written(Z, '42'))
  for (const strict of [false, true]) {
    const alone = requests.map((q) => sliceInput(root, q.file, q.source, q.input, { strict }))
    expect(sliceInputs(root, requests, { strict })).toEqual(alone)
    // every outcome is in the batch
    expect(new Set(alone.map((a) => a.status))).toEqual(new Set(['converted', 'opaque']))
  }
}, 300_000)

test('a run whose shared child fails as a whole falls back to one child per input', () => {
  const requests = [written(Z, 'z.object({ a: z.string() })'), written(Z, 'z.string().email()')]
  // too little time for any child: the batch fails, and each input gets its own child's answer
  const alone = requests.map((q) => sliceInput(root, q.file, q.source, q.input, { timeoutMs: 1 }))
  expect(sliceInputs(root, requests, { timeoutMs: 1 })).toEqual(alone)
  expect(alone.every((a) => a.status === 'opaque')).toBe(true)
  // and with time, both convert from the one child
  expect(sliceInputs(root, requests).map((x) => x.status)).toEqual(['converted', 'converted'])
})

test('the sentinel was never imported, by any test above', () => {
  expect(existsSync(path.join(root, 'lib', 'SENTINEL-HIT'))).toBe(false)
})

// boundary review #4: a literal computed member is the method it names, and each library's own lossy methods count,
// checked against the libraries the slice imports
// review of a8fd2bfc, on the installed zod: a codec converts to its input's schema while its decode can reject what
// that schema accepts
test('a zod codec converts lossy, and is opaque in strict mode', () => {
  // a decode that rejects '' though z.string() accepts it, without ambient globals, which the slice refuses
  const codec =
    "z.object({ when: z.codec(z.string(), z.number(), { decode: (s, ctx) => { if (s === '') ctx.issues.push({ code: 'custom', message: 'empty', input: s }); return s.length }, encode: (n) => 'x'.repeat(n) }) })"
  expect(summary(slice(Z, codec))).toMatchObject({ status: 'converted', lossy: ['codec'] })
  expect(summary(slice(Z, codec, {}, true))).toMatchObject(
    opaque(/strict mode: the schema uses codec/),
  )
})

// a computed member was once read as the method it names; under the allowlist (code review of M8, #3) it's refused
test('a computed literal member, z.string()[‘refine’](…), is refused, in strict mode or not', () => {
  for (const strict of [false, true])
    expect(
      summary(slice(Z, "z.string()['refine']((s) => s.length > 1)", {}, strict)),
    ).toMatchObject(opaque(/a computed key/))
})

// what the plan finds lossy, before anything is evaluated: the libraries here aren't installed, and needn't be
const plannedLossy = (preamble: string, input: string, helpers: Record<string, string> = {}) => {
  const dir = path.join(root, 'app', `case${n++}`)
  mkdirSync(dir)
  for (const [name, text] of Object.entries(helpers)) writeFileSync(path.join(dir, name), text)
  const file = path.join(dir, 'actions.ts')
  const source = `'use server'\nimport { defineAction } from '@affordances/next'\n${preamble}\nexport const act = defineAction({ name: 'act', input: ${input}, run: async () => {} })\n`
  writeFileSync(file, source)
  const [found] = findInputs(file, source)
  const plan = planSlice(file, source, found!.input as never)
  return plan.status === 'slice' ? plan.lossy : plan
}

test.each([
  [
    'valibot',
    "import * as v from 'valibot'",
    'v.pipe(v.string(), v.rawCheck(() => {}), v.rawTransform(() => 1))',
    ['rawCheck', 'rawTransform'],
  ],
  [
    'valibot, by name',
    "import { check, pipe, string } from 'valibot'",
    'pipe(string(), check((s) => s.length > 1))',
    ['check'],
  ],
  [
    'arktype',
    "import { type } from 'arktype'",
    "type('string').narrow((s) => s.length > 1).morph((s) => s.length)",
    ['morph', 'narrow'],
  ],
  [
    'effect, filterEffect',
    "import { Schema } from 'effect'",
    'Schema.String.pipe(Schema.filterEffect(() => true))',
    ['filterEffect'],
  ],
  [
    'valibot, item actions',
    "import * as v from 'valibot'",
    "v.pipe(v.array(v.string()), v.everyItem((s) => s.length > 1), v.someItem((s) => s === 'a'))",
    ['everyItem', 'someItem'],
  ],
  [
    'effect',
    "import { Schema } from 'effect'",
    'Schema.String.pipe(Schema.filter((s) => s.length > 1))',
    ['filter'],
  ],
  [
    'typebox',
    "import { Type } from '@sinclair/typebox'",
    'Type.Transform(Type.String()).Decode((s) => s).Encode((s) => s)',
    ['Decode', 'Encode', 'Transform'],
  ],
])('%s: its lossy methods are named', (_, preamble, input, lossy) => {
  expect(plannedLossy(preamble, input)).toEqual(lossy)
})

test('a method is lossy only for a library the slice imports: an Array’s filter beside zod isn’t Effect’s', () => {
  expect(
    plannedLossy(Z, "z.enum(['a', 'b', ''].filter((x) => x.length > 0) as ['a', 'b'])"),
  ).toEqual([])
  // and a schema refined in a module that never imports the library still counts, since the slice does
  expect(
    plannedLossy("import { base } from './schemas'", 'base.refine((s) => s.length > 1)', {
      'schemas.ts': `${Z}\nexport const base = z.string()\n`,
    }),
  ).toEqual(['refine'])
})

// code review of M8 (#3's follow-up, 22:34Z): the legacy accessors are getPrototypeOf and defineProperty by other
// names, which are banned, so they are too
test.each([
  ['__lookupGetter__', "z.string().default(String(({}).__lookupGetter__('__proto__')))"],
  ['__lookupSetter__', "z.string().default(String(({}).__lookupSetter__('__proto__')))"],
  ['__defineGetter__', "z.string().default(String(({}).__defineGetter__('a', () => 1)))"],
  ['__defineSetter__', "z.string().default(String(({}).__defineSetter__('a', () => {})))"],
])('the legacy accessor %s is out of reach', (member, input) => {
  expect(summary(slice(Z, input))).toMatchObject(opaque(new RegExp(`the ${member} property`)))
})
