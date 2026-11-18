import type { ResourceRef } from './types.ts'

// a projection's start on the wire (RFC 0004 §2.2): a resource as `type:key`, or a capability or resource type id as
// it is. One codec, for every transport that sends a start and the route that reads one

/** @experimental A start as the protocol-1 route's `start` parameter. */
export const encodeStart = (start: string | ResourceRef | undefined): string | undefined =>
  start === undefined ? undefined : typeof start === 'string' ? start : `${start.type}:${start.key}`

/** @experimental The `start` parameter back: `type:key` is a resource, anything else an id; nothing for an empty one. */
export const decodeStart = (value: unknown): string | ResourceRef | undefined => {
  if (typeof value !== 'string' || !value) return undefined
  const at = value.indexOf(':')
  return at === -1 ? value : { type: value.slice(0, at), key: value.slice(at + 1) }
}
