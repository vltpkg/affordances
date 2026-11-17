import type { ProjectionRequest } from '@affordances/runtime'
import { runtime } from './inspect.ts'
import { principalOf } from './principal.ts'

// what an agent-facing route answers: a view, never a projection (RFC 0002 §11). A projection holds every offer the
// principal may see; a view is what the policy discloses, with what it left out counted

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

// `start` is `type:key`, or a capability or resource type's id
const startOf = (value: string | null): ProjectionRequest['start'] => {
  if (!value) return undefined
  const at = value.indexOf(':')
  return at === -1 ? value : { type: value.slice(0, at), key: value.slice(at + 1) }
}

export const serveView = async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const projection = await runtime.project({
    principal: principalOf(request),
    start: startOf(url.searchParams.get('start')),
    policy: url.searchParams.get('policy') ?? undefined,
    seen: url.searchParams.get('seen') ?? undefined,
    task: url.searchParams.get('task') ? { statement: url.searchParams.get('task')! } : undefined,
  })
  return json(projection.view())
}
