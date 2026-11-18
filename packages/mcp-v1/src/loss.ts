import type { CapabilityManifest } from '@affordances/ir'
import { capabilityToolFates, exportable, type Fate } from '@affordances/runtime/agent'

// RFC 0004 §4 and §6, assumption 9, measured on a manifest rather than assumed: for every capability, each thing it
// declares, and what the per-capability mode does with it. The generic mode carries every view byte for byte (the
// server's tests show that under every built-in policy), so its only loss is MCP's per-tool annotations

export type { Fate }
type Row = { capability: string; exported: boolean; fields: Record<string, Fate> }

/** @experimental The per-capability mode's loss on a manifest, field by field, beside the generic mode's (RFC 0004 §6). */
export const lossReport = (m: CapabilityManifest) => {
  const exported = new Set(exportable(m).map((c) => c.id))
  const rows: Row[] = m.capabilities
    .filter((c) => c.kind !== 'event')
    .map((c) => {
      const fields = capabilityToolFates(m, c)
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
