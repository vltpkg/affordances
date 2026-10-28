import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { Call, Delta, Graph, SiteIndex, jsonSchemas } from '../src/index.ts'

const schemas = { graph: Graph, delta: Delta, call: Call, 'site-index': SiteIndex }

// fixture files are named <schema>[.<case>].json; an array holds several cases
const load = (dir: 'valid' | 'invalid') =>
  readdirSync(new URL(`../fixtures/${dir}`, import.meta.url)).flatMap((file) => {
    const kind = file.replace(/(\..+)?\.json$/, '') as keyof typeof schemas
    const data = JSON.parse(
      readFileSync(new URL(`../fixtures/${dir}/${file}`, import.meta.url), 'utf8'),
    )
    return (Array.isArray(data) ? data : [data]).map((value, i) => ({
      name: `${file}#${i}`,
      schema: schemas[kind],
      value,
    }))
  })

describe('fixtures', () => {
  test.each(load('valid'))('$name is valid', ({ schema, value }) => {
    expect(schema.safeParse(value).error).toBeUndefined()
  })
  test.each(load('invalid'))('$name is invalid', ({ schema, value }) => {
    expect(schema.safeParse(value).success).toBe(false)
  })
  test('every error code has a fixture', () => {
    const codes = load('valid').flatMap(({ value }) => (value.error ? [value.error.code] : []))
    expect(new Set(codes)).toEqual(new Set(Delta.shape.error.unwrap().shape.code.options))
  })
})

test('schemas/*.json is up to date', () => {
  for (const [name, schema] of Object.entries(jsonSchemas)) {
    const onDisk = JSON.parse(
      readFileSync(new URL(`../schemas/${name}.json`, import.meta.url), 'utf8'),
    )
    expect(onDisk, `run \`vlr schemas\` in packages/protocol`).toEqual(schema)
  }
})
