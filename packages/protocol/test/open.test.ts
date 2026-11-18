import { readdirSync, readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, test } from 'vitest'
import { Call, Delta, Graph, SiteIndex, jsonSchemas } from '../src/index.ts'

// spec.md:161, Versioning: "Additive changes, such as new optional fields, may ship within a major version, and
// clients must ignore fields they don't recognize." That binds CLIENTS, so the published schemas are open wherever a
// client reads, and closed wherever it doesn't:
//
//   | schema          | who reads it          | objects in it                 |
//   | --------------- | --------------------- | ----------------------------- |
//   | graph.json      | a client              | open, at every depth          |
//   | delta.json      | a client              | open, at every depth          |
//   | site-index.json | a client              | open, at every depth          |
//   | call.json       | the server, from one  | closed, as the server checks  |
//
// The zod schemas parse as before: unknown keys are stripped, so only the published JSON says the documents are open

const spec = readFileSync(new URL('../spec.md', import.meta.url), 'utf8')
const RECEIVED = ['graph', 'delta', 'site-index'] as const
const SENT = ['call'] as const
const schemas = { graph: Graph, delta: Delta, call: Call, 'site-index': SiteIndex }

// every object node in a JSON Schema, with where it is
const objects = (node: unknown, at = '#'): { at: string; node: Record<string, unknown> }[] => {
  if (Array.isArray(node)) return node.flatMap((n, i) => objects(n, `${at}/${i}`))
  if (node === null || typeof node !== 'object') return []
  const o = node as Record<string, unknown>
  const here = o.type === 'object' ? [{ at, node: o }] : []
  return [...here, ...Object.entries(o).flatMap(([k, v]) => objects(v, `${at}/${k}`))]
}
// a document's own definition, through the root's $ref into $defs
const own = (name: keyof typeof jsonSchemas) => {
  const root = jsonSchemas[name] as {
    $ref?: string
    $defs?: Record<string, Record<string, unknown>>
  }
  return root.$ref
    ? root.$defs![root.$ref.replace('#/$defs/', '')]!
    : (root as Record<string, unknown>)
}
const fixtures = (dir: 'valid' | 'invalid') =>
  readdirSync(new URL(`../fixtures/${dir}`, import.meta.url)).flatMap((file) => {
    const kind = file.replace(/(\..+)?\.json$/, '') as keyof typeof schemas
    const data = JSON.parse(
      readFileSync(new URL(`../fixtures/${dir}/${file}`, import.meta.url), 'utf8'),
    )
    return (Array.isArray(data) ? data : [data]).map((value, i) => ({
      name: `${file}#${i}`,
      kind,
      value,
    }))
  })
// an unknown field added at the top level, and inside every nested object and array element
const everywhere = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(everywhere)
  if (value === null || typeof value !== 'object') return value
  return {
    ...Object.fromEntries(Object.entries(value).map(([k, v]) => [k, everywhere(v)])),
    xUnknown: 1,
  }
}

describe('the spec-to-schema table (spec.md:161)', () => {
  test('the spec still says clients must ignore fields they don’t recognize', () => {
    expect(spec).toContain("clients must ignore fields they don't recognize")
  })
  test.each(RECEIVED)('%s.json, which a client reads, closes no object at any depth', (name) => {
    const all = objects(jsonSchemas[name])
    expect(all.length).toBeGreaterThan(0)
    expect(all.filter((o) => o.node.additionalProperties === false).map((o) => o.at)).toEqual([])
  })
  test.each(SENT)('%s.json, which the server reads from a client, stays closed', (name) => {
    expect(own(name).additionalProperties).toBe(false)
  })
})

describe('the published schemas accept unknown fields where the spec says clients must ignore them', () => {
  const ajv = new Ajv2020({ strict: false })
  test.each(fixtures('valid').filter((f) => (RECEIVED as readonly string[]).includes(f.kind)))(
    '$name, with an unknown field at the top level and in every nested object, validates against its schema',
    ({ kind, value }) => {
      const validate = ajv.compile(jsonSchemas[kind])
      expect({ valid: validate(value), errors: validate.errors }).toEqual({
        valid: true,
        errors: null,
      })
      expect({ valid: validate(everywhere(value)), errors: validate.errors }).toEqual({
        valid: true,
        errors: null,
      })
    },
  )
  test.each(fixtures('valid').filter((f) => (SENT as readonly string[]).includes(f.kind)))(
    '$name validates, and with an unknown top-level field, a call is still refused',
    ({ kind, value }) => {
      const validate = ajv.compile(jsonSchemas[kind])
      expect(validate(value)).toBe(true)
      expect(validate({ ...(value as object), xUnknown: 1 })).toBe(false)
    },
  )
})

describe('zod parsing is unchanged', () => {
  // the documents' top level is a zod object of their own, where zod strips what it doesn't declare
  test.each(fixtures('valid'))(
    '$name: an unknown field is still stripped, the result the same',
    ({ kind, value }) => {
      const schema = schemas[kind]
      expect(schema.parse({ ...(value as object), xUnknown: 1 })).toEqual(schema.parse(value))
    },
  )
  test.each(fixtures('invalid'))('$name is still invalid', ({ kind, value }) => {
    expect(schemas[kind].safeParse(value).success).toBe(false)
  })
})
