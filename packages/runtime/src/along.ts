// the directions an expansion can take from an offer, a choice set or a resource (RFC 0002 §6.5; §6.6 for
// comparison). One list: the type, the HTTP route's check and the generic expand tool's schema all derive from it

/** @experimental Every direction `expand` takes. */
export const ALONG = [
  'alternatives',
  'members',
  'relations',
  'contains',
  'enables',
  'more',
  'comparison',
] as const
export type Along = (typeof ALONG)[number]
