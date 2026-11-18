import { createProjectionRoute } from '@affordances/next/projection'
import { manifest } from '../app/capabilities.ts'
import { handlers } from './handlers.ts'
import { principalOf } from './principal.ts'
import { resolvers } from './resolvers.ts'
import { approvals } from './runtime.ts'
import { forTrial } from './trial-env.ts'

// what the agent-facing routes answer: RFC 0004 §2's protocol 1, through next's projection route (M7d: design's
// WebMCP calls {base}/view, /expand, /inspect, /check and /execute). The app keeps its own runtime handlers and their
// guards, and the approval key and single-use store every route shares (src/lib/runtime.ts), so a token one route
// signs verifies in any other. Views, never a projection (RFC 0002 §11); per caller, never cached by anything shared;
// a cookie call needs the site's Origin; RFC 0004 §2.3's statuses
const route = createProjectionRoute({
  // a trial's server reads its task's claim edit (src/lib/trial-env.ts)
  manifest: forTrial(manifest),
  bindings: {},
  handlers,
  resources: resolvers,
  principal: principalOf,
  approvalKey: approvals.key,
  seenTokens: approvals.seen,
})

// each operation by the path it's served at, the route telling them apart by their last segment
export const serveView = route.GET
export const serveInspect = route.GET
export const serveExpand = route.POST
export const serveCheck = route.POST
export const serveExecute = route.POST
