import { builtInPolicies, type Expansion, type ProjectionRequest } from '@affordances/runtime'
import { runtime } from './inspect.ts'
import { principalOf } from './principal.ts'

// what the agent-facing routes answer: views, and one offer's details, never a projection (RFC 0002 §11). A
// projection holds every offer the principal may see; a view is what the policy discloses, with what it left out
// counted. Each request projects afresh: the runtime is stateless, and the revision says when a view is stale

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    // per caller, and never cached by anything shared
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
      vary: 'Authorization, Cookie',
    },
  })

const refuse = (status: number, message: string) => json({ error: message }, status)

const POLICIES = new Set(builtInPolicies.map((p) => p.id))
const ALONG = new Set<Expansion['along']>([
  'alternatives',
  'members',
  'relations',
  'contains',
  'enables',
  'more',
])

// `start` is `type:key`, or a capability or resource type's id
const startOf = (value: unknown): ProjectionRequest['start'] => {
  if (typeof value !== 'string' || !value) return undefined
  const at = value.indexOf(':')
  return at === -1 ? value : { type: value.slice(0, at), key: value.slice(at + 1) }
}

type Params = { policy?: unknown; start?: unknown; seen?: unknown; task?: unknown; offer?: unknown }

// the projection request a route's parameters describe, or why it can't be made
const projectionOf = (request: Request, p: Params): ProjectionRequest | string => {
  const policy = typeof p.policy === 'string' && p.policy ? p.policy : undefined
  if (policy && !POLICIES.has(policy))
    return `No policy ${policy}: one of ${[...POLICIES].join(', ')}`
  return {
    principal: principalOf(request),
    start: startOf(p.start),
    policy,
    seen: typeof p.seen === 'string' && p.seen ? p.seen : undefined,
    task: typeof p.task === 'string' && p.task ? { statement: p.task } : undefined,
  }
}

const query = (request: Request): Params => Object.fromEntries(new URL(request.url).searchParams)

// GET /api/projection: the view a policy discloses (RFC 0002 §6.2)
export const serveView = async (request: Request): Promise<Response> => {
  const p = projectionOf(request, query(request))
  if (typeof p === 'string') return refuse(400, p)
  return json((await runtime.project(p)).view())
}

// POST /api/projection/expand { from, along, budget?, policy?, start?, seen?, task? }: more of the projection, as
// a view under the same rules (RFC 0002 §6.5)
export const serveExpand = async (request: Request): Promise<Response> => {
  const body = (await request.json().catch(() => undefined)) as
    | (Params & { from?: unknown; along?: unknown; budget?: unknown })
    | undefined
  if (!body || typeof body !== 'object') return refuse(400, 'The body is a JSON object')
  const { from, along } = body
  const fromOk =
    typeof from === 'string' ||
    (from !== null && typeof from === 'object' && 'type' in from && 'key' in from)
  if (!fromOk) return refuse(400, 'from is an offer id, a choice set id, or { type, key }')
  if (typeof along !== 'string' || !ALONG.has(along as Expansion['along']))
    return refuse(400, `along is one of ${[...ALONG].join(', ')}`)
  const p = projectionOf(request, body)
  if (typeof p === 'string') return refuse(400, p)
  const projection = await runtime.project(p)
  try {
    const budget = body.budget as { offers?: number } | undefined
    return json(
      await projection.expand(
        { from: from as Expansion['from'], along: along as Expansion['along'] },
        { budget },
      ),
    )
  } catch (error) {
    return refuse(400, (error as Error).message)
  }
}

// GET /api/projection/inspect?offer=…: one offer, with its capability's definition and derived edges (RFC 0002 §6.5)
export const serveInspect = async (request: Request): Promise<Response> => {
  const params = query(request)
  const offer = params.offer
  if (typeof offer !== 'string' || !offer) return refuse(400, 'offer is an offer id')
  const p = projectionOf(request, params)
  if (typeof p === 'string') return refuse(400, p)
  const projection = await runtime.project(p)
  try {
    return json(await projection.inspect(offer))
  } catch {
    // an offer the principal may not see answers as one that doesn't exist
    return refuse(404, `No offer ${offer}`)
  }
}
