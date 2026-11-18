// where withAffordances's rewrites send graph requests, and where `affordances init` (@affordances/cli) puts the route handler; other
// Affordances plugins (md) live beside it under /api/affordances/<name>
export const API_PATH = '/api/affordances/graph'

// RFC 0004 §2's discovery (M7b2): where the capability manifest is served, under the catch-all as the index is, and
// version 1's default base, the projection route's mount
export const MANIFEST_PATH = '/.well-known/affordances/manifest.json'
export const PROJECTION_BASE = '/api/projection'
// RFC 0004 §1: version 1 keeps v0's media type, with a version parameter, so a v0 client never takes a version-1
// document for its own
export const PROTOCOL_1_MEDIA_TYPE = 'application/vnd.affordances+json; version=1'
