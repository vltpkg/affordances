import { localId, type CapabilityManifest } from '@affordances/ir'
import { exportable } from './server.ts'

// RFC 0004 §4 and §6, assumption 9, measured on a manifest rather than assumed: for every capability, each thing it
// declares, and what the per-capability mode does with it. The generic mode carries every view byte for byte (the
// server's tests show that under every built-in policy), so its only loss is MCP's per-tool annotations

/** @experimental What a tool does with one thing a capability declares. */
export type Fate =
  | 'carried' // in the tool as it is
  | 'partial' // in the tool, reduced: a boolean annotation, or text in the description
  | 'at-call' // not in the tool, but enforced when it's called: the runtime's checks and the person's confirmation
  | 'lost' // nowhere an agent reading the tool list can see it

type Capability = CapabilityManifest['capabilities'][number]
type Row = { capability: string; exported: boolean; fields: Record<string, Fate> }

// what one capability declares, and in the per-capability mode, its fate
const fieldsOf = (m: CapabilityManifest, c: Capability): Record<string, Fate> => {
  const effects = c.effects ?? []
  const target = c.target ? m.resources.find((r) => r.id === c.target) : undefined
  const out: Record<string, Fate> = {
    id: 'carried',
    description: 'carried',
    kind: c.safe === true ? 'partial' : 'lost',
  }
  if (c.input) out.input = 'carried'
  if (c.output) out.output = 'lost'
  if (c.safe !== undefined) out.safe = 'partial'
  if (c.idempotent !== undefined) out.idempotent = 'partial'
  if (c.target) out.target = 'lost'
  if (c.references?.length) out.references = 'lost'
  if (c.preconditions?.length) out.preconditions = 'at-call'
  if (c.authorization) out.authorization = 'at-call'
  if (c.authorization?.conditions?.length) out['authorization.conditions'] = 'at-call'
  if (c.confirmation) out.confirmation = 'at-call'
  // reversibility beyond MCP's destructive boolean, and an external effect as open-world, are reduced
  if (effects.some((e) => e.reversibility)) out['effects.reversibility'] = 'partial'
  if (effects.some((e) => e.category === 'external')) out['effects.external'] = 'partial'
  // a charge's amount: in the description as the summary's charges clause, unknown when it's read from the target
  if (effects.some((e) => e.category === 'financial')) out['effects.financial'] = 'partial'
  if (effects.some((e) => e.category === 'state')) out['effects.state'] = 'lost'
  if ((m.claims ?? []).some((k) => localId(m, k.subject) === c.id)) out.claims = 'lost'
  if ((m.relations ?? []).some((r) => localId(m, r.from) === c.id || localId(m, r.to) === c.id))
    out.relations = 'lost'
  // what a view says per caller and per instance: never in a tool list
  if (target?.alternatives) out.choiceSet = 'lost'
  out.availability = 'lost'
  out.revision = 'lost'
  out.relevance = 'lost'
  return out
}

/** @experimental The per-capability mode's loss on a manifest, field by field, beside the generic mode's (RFC 0004 §6). */
export const lossReport = (m: CapabilityManifest) => {
  const exported = new Set(exportable(m).map((c) => c.id))
  const rows: Row[] = m.capabilities
    .filter((c) => c.kind !== 'event')
    .map((c) => {
      const fields = fieldsOf(m, c)
      // a capability that isn't exported has no tool: everything it declares is lost in this mode
      return {
        capability: c.id,
        exported: exported.has(c.id),
        fields: exported.has(c.id)
          ? fields
          : Object.fromEntries(Object.keys(fields).map((f) => [f, 'lost' as const])),
      }
    })
  const tally = (fate: Fate) =>
    rows.reduce((n, r) => n + Object.values(r.fields).filter((f) => f === fate).length, 0)
  return {
    generic: { carries: 'every view, byte for byte', lost: ['per-tool annotations'] },
    perCapability: {
      capabilities: rows.length,
      exported: exported.size,
      fields: {
        carried: tally('carried'),
        partial: tally('partial'),
        atCall: tally('at-call'),
        lost: tally('lost'),
      },
      rows,
    },
  }
}
