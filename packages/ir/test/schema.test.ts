import { readdirSync, readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, test } from 'vitest'
import { CapabilityManifest, jsonSchema } from '../src/index.ts'

const fixture = (file: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/valid/${file}`, import.meta.url), 'utf8'))
const valid = readdirSync(new URL('../fixtures/valid', import.meta.url)).map((file) => ({
  file,
  manifest: fixture(file),
}))

// schema.json, compiled as a non-TypeScript client would use it
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true })
const checkJson = ajv.compile(jsonSchema())

// both readers of the IR must agree: zod (validate's first step) and schema.json
const accepts = (manifest: unknown) => ({
  zod: CapabilityManifest.safeParse(manifest).success,
  json: checkJson(manifest),
})

describe('valid fixtures', () => {
  test.each(valid)('$file is accepted by zod and by schema.json', ({ manifest }) => {
    expect(accepts(manifest)).toEqual({ zod: true, json: true })
  })
})

// a valid manifest with one thing wrong: each case is rejected by both
const base = () => fixture('plans.json')
type Manifest = ReturnType<typeof base>
const subscribe = (m: Manifest) => m.capabilities[1]
const invalid: [string, (m: Manifest) => void][] = [
  ['an id with a capital first letter', (m) => (m.resources[0].id = 'Hosting.plan')],
  ['an id over 128 characters', (m) => (m.resources[0].id = `a${'b'.repeat(128)}`)],
  ['a namespace with a fragment', (m) => (m.namespace = 'https://hosting.example/c#x')],
  ['a relative namespace', (m) => (m.namespace = '/capabilities')],
  ['the wrong schemaVersion', (m) => (m.schemaVersion = '0.2')],
  ['an unknown top-level field', (m) => (m.extra = true)],
  ['an unknown field on a capability', (m) => (subscribe(m).recommended = true)],
  [
    'a condition with both expr and guard',
    (m) => (subscribe(m).preconditions[4].expr = { exists: 'target.slug' }),
  ],
  [
    'a comparison with three operands',
    (m) => subscribe(m).preconditions[0].expr.ne.push({ value: 1 }),
  ],
  [
    'an Expr object with two operators',
    (m) => (subscribe(m).preconditions[0].expr.exists = 'target.slug'),
  ],
  ['an empty all', (m) => (subscribe(m).preconditions[0].expr = { all: [] })],
  ['a quantifier without where', (m) => delete subscribe(m).preconditions[2].expr.some.where],
  ['a path with no attribute', (m) => (subscribe(m).preconditions[0].expr.ne[0].path = 'target')],
  ['a reference named after a root', (m) => (subscribe(m).references[0].name = 'item')],
  ['a reference with a non-pointer at', (m) => (subscribe(m).references[0].at = 'projectId')],
  ['verified without evidence', (m) => delete m.claims[1].provenance.evidence],
  [
    'imported with empty evidence',
    (m) => (m.provenance = { source: 'host', basis: 'imported', evidence: [] }),
  ],
  ['a query with effects', (m) => (m.capabilities[0].effects = subscribe(m).effects)],
  ['a query that says it is not safe', (m) => (m.capabilities[0].safe = false)],
  ['a safe action', (m) => (subscribe(m).safe = true)],
  ['an event with input', (m) => (m.capabilities[3].input = { type: 'object' })],
  [
    'a compensable effect without compensatedBy',
    (m) => delete subscribe(m).effects[0].compensatedBy,
  ],
  [
    'a state effect without a resource',
    (m) => (subscribe(m).effects = [{ category: 'state', change: 'update', description: 'x' }]),
  ],
  ['relatedTo without a description', (m) => delete m.relations[0].description],
  ['a binding with no address', (m) => (m.bindings[0].address = {})],
  ['an extension key that is not a URI', (m) => (m.extensions = { region: 'eu' })],
  ['a claim with a confidence score', (m) => (m.claims[0].confidence = 0.8)],
  ['confirmation without a summary', (m) => (subscribe(m).confirmation = {})],
  ['confirmation with required: false', (m) => (subscribe(m).confirmation.required = false)],
]

describe('invalid manifests', () => {
  test.each(invalid)('%s is rejected by zod and by schema.json', (_, mutate) => {
    const manifest = base()
    mutate(manifest)
    expect(accepts(manifest)).toEqual({ zod: false, json: false })
  })
})

test('schema.json is up to date', () => {
  const onDisk = JSON.parse(readFileSync(new URL('../schema.json', import.meta.url), 'utf8'))
  expect(onDisk, 'run `vlr schema` in packages/ir, then `vlr fmt` at the root').toEqual(
    jsonSchema(),
  )
})
