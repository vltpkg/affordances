import { writeFileSync } from 'node:fs'
import { jsonSchemas } from '../src/json-schema.ts'

for (const [name, schema] of Object.entries(jsonSchemas))
  writeFileSync(
    new URL(`../schemas/${name}.json`, import.meta.url),
    `${JSON.stringify(schema, null, 2)}\n`,
  )
