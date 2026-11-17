import {
  builtInPolicies,
  type Budget,
  type Expansion,
  type ProjectionRequest,
} from '@affordances/runtime'
import { runtime } from './runtime.ts'
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

const MAX_AFTER = 32

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

// offers is the request's budget: how many offers its first view shows (RFC 0002 §6.3). An expansion's own budget
// is the expand body's budget
type Params = {
  policy?: unknown
  start?: unknown
  seen?: unknown
  task?: unknown
  offers?: unknown
  offer?: unknown
}

// the projection request a route's parameters describe, or why it can't be made
const projectionOf = (request: Request, p: Params): ProjectionRequest | string => {
  const policy = typeof p.policy === 'string' && p.policy ? p.policy : undefined
  if (policy && !POLICIES.has(policy))
    return `No policy ${policy}: one of ${[...POLICIES].join(', ')}`
  const offers = p.offers === undefined || p.offers === '' ? undefined : Number(p.offers)
  if (offers !== undefined && !(Number.isInteger(offers) && offers > 0))
    return 'offers is a positive whole number'
  return {
    principal: principalOf(request),
    start: startOf(p.start),
    policy,
    seen: typeof p.seen === 'string' && p.seen ? p.seen : undefined,
    task: typeof p.task === 'string' && p.task ? { statement: p.task } : undefined,
    budget: offers === undefined ? undefined : { offers },
  }
}

const query = (request: Request): Params => Object.fromEntries(new URL(request.url).searchParams)

// GET /api/projection: the view a policy discloses (RFC 0002 §6.2)
export const serveView = async (request: Request): Promise<Response> => {
  const p = projectionOf(request, query(request))
  if (typeof p === 'string') return refuse(400, p)
  return json((await runtime.project(p)).view())
}

type Step = { from: Expansion['from']; along: Expansion['along']; budget?: Budget }

// one expansion as the body names it, or why it can't be one
const stepOf = (value: unknown): Step | string => {
  if (!value || typeof value !== 'object') return 'an expansion is { from, along, budget? }'
  const { from, along, budget } = value as Record<string, unknown>
  const fromOk =
    typeof from === 'string' ||
    (from !== null && typeof from === 'object' && 'type' in from && 'key' in from)
  if (!fromOk) return 'from is an offer id, a choice set id, a more cursor, or { type, key }'
  if (typeof along !== 'string' || !ALONG.has(along as Expansion['along']))
    return `along is one of ${[...ALONG].join(', ')}`
  if (budget !== undefined && (budget === null || typeof budget !== 'object'))
    return 'budget is { offers? }'
  return {
    from: from as Expansion['from'],
    along: along as Expansion['along'],
    budget: budget as Budget,
  }
}

// POST /api/projection/expand { from, along, budget?, after?, policy?, start?, seen?, task? }: more of the
// projection, as a view under the same rules (RFC 0002 §6.5).
//
// Each request projects afresh, and a cursor an expansion's page hands out only resolves where that expansion was
// taken. So `after` lists the expansions already taken to reach `from`, in order, and they're replayed first. It
// reaches nothing a caller couldn't expand to directly
export const serveExpand = async (request: Request): Promise<Response> => {
  const body = (await request.json().catch(() => undefined)) as
    | (Params & { after?: unknown })
    | undefined
  if (!body || typeof body !== 'object') return refuse(400, 'The body is a JSON object')
  const step = stepOf(body)
  if (typeof step === 'string') return refuse(400, step)
  if (body.after !== undefined && !Array.isArray(body.after))
    return refuse(400, 'after is the list of expansions already taken')
  // every replay is an expansion the request pays for again: bounded, so one request can't do unbounded work
  if (((body.after as unknown[] | undefined)?.length ?? 0) > MAX_AFTER)
    return refuse(400, `after lists at most ${MAX_AFTER} expansions`)
  const after: Step[] = []
  for (const a of (body.after as unknown[] | undefined) ?? []) {
    const s = stepOf(a)
    if (typeof s === 'string') return refuse(400, `after: ${s}`)
    after.push(s)
  }
  const p = projectionOf(request, body)
  if (typeof p === 'string') return refuse(400, p)
  const projection = await runtime.project(p)
  try {
    for (const a of after) await projection.expand(a, { budget: a.budget })
    return json(await projection.expand(step, { budget: step.budget }))
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

// a refusal's HTTP status, so a client that reads only the status still gets it right
const STATUS: Record<string, number> = {
  not_found: 404,
  unauthorized: 403,
  rate_limited: 429,
  invalid_input: 400,
  precondition: 409,
  stale: 409,
  confirmation_required: 409,
}

// POST /api/projection/execute { offer, input?, approval?, ifRevision? }: run an offer, every check first (RFC 0002
// §8.1). A capability that requires confirmation is refused with its summary and an approval token, the first time;
// sending the same call with that token runs it, once
export const serveExecute = async (request: Request): Promise<Response> => {
  const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | undefined
  if (!body || typeof body !== 'object') return refuse(400, 'The body is a JSON object')
  const { offer, input, approval, ifRevision } = body
  if (typeof offer !== 'string' || !offer) return refuse(400, 'offer is an offer id')
  if (approval !== undefined && typeof approval !== 'string')
    return refuse(400, 'approval is a token')
  if (ifRevision !== undefined && typeof ifRevision !== 'string')
    return refuse(400, 'ifRevision is an offer revision')
  const result = await runtime.execute({
    principal: principalOf(request),
    offer,
    input,
    approval,
    ifRevision,
  })
  return json(
    result,
    result.status === 'succeeded'
      ? 200
      : result.status === 'failed'
        ? 500
        : (STATUS[result.code] ?? 400),
  )
}
