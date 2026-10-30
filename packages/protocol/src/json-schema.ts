import { z } from 'zod'
import { Call, Delta, Graph, SiteIndex } from './schema.ts'

// the documents a non-TypeScript client validates against; schemas/*.json is this, written to disk
export const jsonSchemas = {
  graph: z.toJSONSchema(Graph),
  call: z.toJSONSchema(Call),
  delta: z.toJSONSchema(Delta),
  'site-index': z.toJSONSchema(SiteIndex),
}
