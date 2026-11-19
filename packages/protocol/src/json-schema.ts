import { z } from 'zod'
import { Call, Delta, Graph, SiteIndex } from './schema.ts'

// the documents a non-TypeScript client validates against; schemas/*.json is this, written to disk.
// spec.md's Versioning: additive changes ship within a major version, and clients must ignore fields they don't
// recognize. So what a client receives (a graph, a delta, the site index) is open at every level: an object never
// says additionalProperties: false. Only here, in the published schemas; the zod schemas still strip unknown keys when
// they parse. What a client sends (a call) is the server's to check, and stays closed
const open = (schema: z.ZodType) =>
  z.toJSONSchema(schema, {
    override: ({ jsonSchema }) => {
      if (jsonSchema.additionalProperties === false) delete jsonSchema.additionalProperties
    },
  })

export const jsonSchemas = {
  graph: open(Graph),
  call: z.toJSONSchema(Call),
  delta: open(Delta),
  'site-index': open(SiteIndex),
}
