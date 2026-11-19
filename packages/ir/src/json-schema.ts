import { z } from 'zod'
import { CapabilityManifest, EVIDENCED, ROOTS, SCHEMA_ID } from './schema.ts'

type Schema = Record<string, unknown>

// JSON Schema's if/then: `then` is the keyword's name, not a promise's
// oxlint-disable-next-line unicorn/no-thenable
const ifThen = (cond: Schema, then: Schema): Schema => ({ if: cond, then })

// the rules zod states as refinements, as conditional subschemas, so schema.json accepts what zod accepts
// (RFC 0001 §14); keyed by the $defs entry they belong to
const conditional: Record<string, Schema[]> = {
  Provenance: [
    ifThen(
      { properties: { basis: { enum: EVIDENCED } } },
      {
        type: 'object',
        required: ['evidence'],
        properties: { evidence: { type: 'array', minItems: 1 } },
      },
    ),
  ],
  CapabilityDefinition: [
    ifThen(
      { properties: { kind: { const: 'query' } } },
      { properties: { safe: { const: true }, effects: { type: 'array', maxItems: 0 } } },
    ),
    ifThen(
      { properties: { kind: { const: 'action' } } },
      { properties: { safe: { const: false } } },
    ),
    // targetAt needs a target
    ifThen(
      { type: 'object', properties: { targetAt: true }, required: ['targetAt'] },
      { type: 'object', properties: { target: true }, required: ['target'] },
    ),
    // a false subschema: the property must not be there
    ifThen(
      { properties: { kind: { const: 'event' } } },
      {
        properties: Object.fromEntries(
          ['input', 'preconditions', 'confirmation', 'effects'].map((f) => [f, false]),
        ),
      },
    ),
  ],
  Effect: [
    ifThen(
      {
        type: 'object',
        properties: { reversibility: { const: 'compensable' } },
        required: ['reversibility'],
      },
      { type: 'object', properties: { compensatedBy: true }, required: ['compensatedBy'] },
    ),
  ],
  Relation: [
    ifThen(
      { properties: { type: { const: 'relatedTo' } } },
      { type: 'object', properties: { description: true }, required: ['description'] },
    ),
  ],
  Binding: [{ properties: { address: { type: 'object', minProperties: 1 } } }],
  Reference: [{ properties: { name: { type: 'string', not: { enum: ROOTS } } } }],
}

// the manifest's JSON Schema 2020-12 document, written to schema.json
export const jsonSchema = (): Schema => {
  const schema = z.toJSONSchema(CapabilityManifest, { target: 'draft-2020-12' }) as Schema & {
    $defs: Record<string, Schema>
  }
  for (const [id, extra] of Object.entries(conditional)) {
    const def = schema.$defs[id]
    if (!def) throw new Error(`no $defs entry ${id}`)
    def.allOf = [...((def.allOf as Schema[] | undefined) ?? []), ...extra]
  }
  return { $schema: schema.$schema, $id: SCHEMA_ID, ...schema }
}
