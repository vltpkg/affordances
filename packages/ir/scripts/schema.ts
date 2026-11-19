import { writeFileSync } from 'node:fs'
import { jsonSchema } from '../src/json-schema.ts'

writeFileSync(
  new URL('../schema.json', import.meta.url),
  `${JSON.stringify(jsonSchema(), null, 2)}\n`,
)
