import { canonicalJson } from '@affordances/ir'

// a trial's request events, once each: the replay, the MCP and v0 surfaces' readers and the browser's all keep the
// first of each, in order, and drop a repeat

/** A request's identity: its offer and its input, by RFC 8785 bytes, so a repeated request is one. */
export const keyOf = (r: { offer: string; input?: unknown }) =>
  canonicalJson({ offer: r.offer, input: r.input ?? null })

/** The items whose key hasn't been seen before them, in order. */
export const uniqueBy = <T>(items: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
