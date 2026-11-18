// where withAffordances's rewrites send graph requests, and where `affordances init` (@affordances/cli) puts the route handler; other
// Affordances plugins (md) live beside it under /api/affordances/<name>
export const API_PATH = '/api/affordances/graph'

// RFC 0004 §2's discovery (M7b2): where the capability manifest is served, under the catch-all as the index is, and
// version 1's default base, the projection route's mount
export const MANIFEST_PATH = '/.well-known/affordances/manifest.json'
export const PROJECTION_BASE = '/api/projection'
