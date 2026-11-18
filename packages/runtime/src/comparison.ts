import { canonicalJson, summaryPaths, type CapabilityDefinition } from '@affordances/ir'
import type { Comparison, OfferId } from './types.ts'

// RFC 0002 §6.6, rule 6 of the disclosure invariant: a choice set carries its comparison, every declared attribute of
// every member, as the resolvers returned them. Built from the targets the projection already loaded, so it reads
// nothing new (§7)

type Obj = Record<string, unknown>

/** A choice set's members, each with the attributes its resolver returned, or none when it couldn't load them. */
export type Members = { id: OfferId; attributes: Obj | undefined }[]

// the columns in the runtime's fixed order (§6.6): what a shown claim cites, then what the capability reads, then the
// rest in declared order. The first two groups are never cut
export const columnsOf = (
  declared: string[],
  cited: ReadonlySet<string>,
  read: ReadonlySet<string>,
): { columns: string[]; kept: number } => {
  const first = declared.filter((c) => cited.has(c))
  const second = declared.filter((c) => !cited.has(c) && read.has(c))
  const rest = declared.filter((c) => !cited.has(c) && !read.has(c))
  return { columns: [...first, ...second, ...rest], kept: first.length + second.length }
}

// a value's identity, by its RFC 8785 bytes, so an object or array cell compares whole
const bytes = (v: unknown) => canonicalJson(v)

/**
 * The comparison of one choice set: `facts`, the request's own limit in cells, cuts columns from the end of the
 * order, past the kept ones, and names each; no limit, no cut.
 */
export const comparisonOf = (
  members: Members,
  order: { columns: string[]; kept: number },
  facts?: number,
): Comparison => {
  const supplied = (m: Members[number], c: string) =>
    m.attributes !== undefined && Object.hasOwn(m.attributes, c)
  // a column is shared when every member supplied it with one value: one cell. Otherwise one cell per member
  const sharedValue = (c: string): { value: unknown } | undefined => {
    if (!members.length || !members.every((m) => supplied(m, c))) return
    const first = bytes(members[0]!.attributes![c])
    return members.every((m) => bytes(m.attributes![c]) === first)
      ? { value: members[0]!.attributes![c] }
      : undefined
  }
  const cells = (c: string) => (sharedValue(c) ? 1 : members.length)

  const shown: string[] = []
  const omitted: string[] = []
  let used = 0
  order.columns.forEach((c, i) => {
    const kept = i < order.kept
    if (kept || (omitted.length === 0 && (facts === undefined || used + cells(c) <= facts))) {
      shown.push(c)
      used += cells(c)
    } else omitted.push(c)
  })

  const differ: string[] = []
  const shared: Obj = {}
  for (const c of shown) {
    const s = sharedValue(c)
    if (s) shared[c] = s.value
    else differ.push(c)
  }
  return {
    differ,
    rows: members.map((m) =>
      Object.fromEntries(differ.filter((c) => supplied(m, c)).map((c) => [c, m.attributes![c]])),
    ),
    shared,
    unsupplied: members.flatMap((m) => {
      const attributes = shown.filter((c) => !supplied(m, c))
      return attributes.length ? [{ member: m.id, attributes }] : []
    }),
    omitted: { attributes: omitted },
  }
}

// the target attributes a capability's confirmation summary renders, by each {target.x} path's first segment: what a
// person approves names them, so they're never cut (intake, 2026-11-18 12:06Z)
export const summaryReads = (template: string | undefined): Set<string> =>
  new Set(
    summaryPaths(template ?? '').flatMap((p) => {
      const m = /^target\.([^.[\]]+)/.exec(p)
      return m ? [m[1]!] : []
    }),
  )

// the target attributes a capability's conditions and effects read: every `target.x` path, by its first segment
export const targetReads = (definition: unknown): Set<string> => {
  const out = new Set<string>()
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      const m = /^target\.([^.[\]]+)/.exec(v)
      if (m) out.add(m[1]!)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(definition)
  return out
}

/**
 * @experimental The comparison columns a choice set can't cut (RFC 0002 §6.6), from the set's capability and the
 * claims shown on its members: what those claims cite, and what the capability's conditions and effects read and its
 * confirmation summary renders. The runtime's views keep exactly these; the inspector marks them by the same rule
 * (code review of M8, #9). Under a policy that omits claims, no claim is shown, so pass none.
 */
export const keptColumns = (
  capability: CapabilityDefinition | undefined,
  shownClaims: readonly { cites?: readonly string[] }[],
): { cited: Set<string>; read: Set<string> } => ({
  cited: new Set(shownClaims.flatMap((k) => k.cites ?? [])),
  read: new Set([
    ...targetReads([
      capability?.preconditions,
      capability?.authorization?.conditions,
      capability?.effects,
    ]),
    ...summaryReads(capability?.confirmation?.summary),
  ]),
})
