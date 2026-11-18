import { Id, putPointer, type CapabilityManifest } from '@affordances/ir'
import type { OfferId, ResourceRef } from './types.ts'

// RFC 0002 §4.1: the capability, then @ and the target's type and key, then the bound references in canonical
// order; keys percent-encoded. 'commerce.cart.addItem@commerce.cart:c_8f2?product=heavyweight-tee'. An id names
// an opportunity; it grants nothing, and execution resolves it afresh
export type OfferParts = { capability: Id; target?: ResourceRef; with?: Record<string, string> }

export const offerId = ({ capability, target, with: bound }: OfferParts): OfferId => {
  let id = capability
  if (target) id += `@${target.type}:${encodeURIComponent(target.key)}`
  const names = Object.keys(bound ?? {}).toSorted()
  if (names.length) id += `?${names.map((n) => `${n}=${encodeURIComponent(bound![n]!)}`).join('&')}`
  return id
}

// ir's Id: the identifier syntax, 128 characters at most (RFC 0001 §6.1)
const isId = (s: string | undefined) => s !== undefined && Id.safeParse(s).success
// the parts of an id an agent sent, or undefined when it isn't one
export const parseOfferId = (id: string): OfferParts | undefined => {
  const match = id.match(/^([^@?]+)(?:@([^:?]+):([^?]*))?(?:\?(.*))?$/)
  if (!match) return
  const [, capability, type, key, query] = match
  if (!isId(capability) || (type !== undefined && !isId(type))) return
  const parts: OfferParts = { capability: capability! }
  try {
    if (type !== undefined) parts.target = { type, key: decodeURIComponent(key!) }
    if (query) {
      const bound: Record<string, string> = {}
      for (const pair of query.split('&')) {
        const at = pair.indexOf('=')
        if (at < 1) return
        bound[pair.slice(0, at)] = decodeURIComponent(pair.slice(at + 1))
      }
      parts.with = bound
    }
  } catch {
    // a malformed escape: not an id
    return
  }
  // canonical only: the same opportunity has one id
  return offerId(parts) === id ? parts : undefined
}

/**
 * @experimental The input fields an offer id fixes for its capability, from the manifest: the target's key at the
 * capability's `targetAt`, and each bound reference's key at its `at` (RFC 0001 §2.2). Nothing for an id that isn't
 * one, or a capability that doesn't say where its keys go.
 */
export const inputOf = (manifest: CapabilityManifest, offer: string): Record<string, unknown> => {
  const parts = parseOfferId(offer)
  const c = parts && manifest.capabilities.find((x) => x.id === parts.capability)
  const input: Record<string, unknown> = {}
  if (!c) return input
  if (c.targetAt !== undefined && parts.target) putPointer(input, c.targetAt, parts.target.key)
  for (const r of c.references ?? [])
    if (parts.with?.[r.name] !== undefined) putPointer(input, r.at, parts.with[r.name])
  return input
}
