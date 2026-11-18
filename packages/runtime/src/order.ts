import type { OrderBasis } from './types.ts'

// §6.4: whether a value is an order basis the runtime can state truthfully. A group's key must be one of the closed
// set of manifest-derived attributes, and a group's order within never names a claim (intake, 2026-11-18)
const GROUP_KEYS = new Set(['targetType'])
// the relevance methods the runtime implements: a method is named, never free text, so it can't carry framing either
// (review of 1615e7f3)
export const RELEVANCE_METHODS = new Set(['basic'])
const fail = (problem: string) => ({ ok: false as const, problem })

export const checkOrderBasis = (
  basis: unknown,
  { inGroup = false } = {},
): { ok: true; basis: OrderBasis } | { ok: false; problem: string } => {
  const b = basis as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return { ok: false, problem: 'an order basis is an object' }
  const extra = (allowed: string[]) => Object.keys(b).filter((k) => !allowed.includes(k))
  if (b.by === 'canonical') {
    if (extra(['by']).length) return fail(`canonical takes no ${extra(['by']).join(', ')}`)
  } else if (b.by === 'relevance') {
    if (typeof b.method !== 'string' || !RELEVANCE_METHODS.has(b.method))
      return fail(
        `relevance's method is one of ${[...RELEVANCE_METHODS].join(', ')}, not ${JSON.stringify(b.method)}`,
      )
    if (extra(['by', 'method']).length)
      return fail(`relevance takes no ${extra(['by', 'method']).join(', ')}`)
  } else if (b.by === 'claim') {
    if (inGroup) return fail('a group’s order within names no claim')
    if (b.kind !== 'recommendation' || typeof b.source !== 'string' || !b.source)
      return fail('a claim basis is a named source’s recommendations')
    if (extra(['by', 'kind', 'source']).length)
      return fail(`a claim basis takes no ${extra(['by', 'kind', 'source']).join(', ')}`)
  } else if (b.by === 'group') {
    if (typeof b.key !== 'string' || !GROUP_KEYS.has(b.key))
      return fail(
        `a group's key is one of ${[...GROUP_KEYS].join(', ')}, not ${JSON.stringify(b.key)}`,
      )
    if (extra(['by', 'key', 'within']).length)
      return fail(`a group takes no ${extra(['by', 'key', 'within']).join(', ')}`)
    const within = checkOrderBasis(b.within, { inGroup: true })
    if (!within.ok) return fail(`within: ${within.problem}`)
  } else return fail(`no order basis is by ${JSON.stringify(b.by)}`)
  return { ok: true, basis: b as OrderBasis }
}

// a basis that names no claim, recommendation or source, at any depth: what a structural rendering may state
export const claimFree = (basis: OrderBasis): boolean =>
  basis.by === 'claim' ? false : basis.by === 'group' ? claimFree(basis.within) : true
