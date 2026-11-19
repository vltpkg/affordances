import type { ExecutionResult } from './types.ts'

// RFC 0004 §2.3's statuses for the runtime's results, in HTTP's own meanings, for any host that serves them over HTTP:
// one mapping, so hosts can't drift. unauthorized is 401 for a caller who isn't
// signed in, with a challenge, and 403 for one who is; input that fails the schema is 422; a precondition, a stale
// revision and a confirmation still owed are 409; rate_limited is 429, with Retry-After when the refusal says when.
// A body that isn't a call at all is the host's own 400, before the runtime. v0's responses keep v0's statuses

const STATUS: Record<string, number> = {
  not_found: 404,
  rate_limited: 429,
  invalid_input: 422,
  precondition: 409,
  stale: 409,
  confirmation_required: 409,
}

/** @experimental An execution result's HTTP status and headers (RFC 0004 §2.3), for the principal it ran for. */
export const statusOf = (
  result: Pick<ExecutionResult, 'status'> & { code?: string; retryAfterSeconds?: number },
  principal: { authenticated: boolean },
): { status: number; headers: Record<string, string> } => {
  if (result.status === 'succeeded') return { status: 200, headers: {} }
  if (result.status === 'failed') return { status: 500, headers: {} }
  if (result.code === 'unauthorized')
    return principal.authenticated
      ? { status: 403, headers: {} }
      : { status: 401, headers: { 'www-authenticate': 'Bearer' } }
  if (result.code === 'rate_limited')
    return {
      status: 429,
      headers:
        result.retryAfterSeconds !== undefined && Number.isFinite(result.retryAfterSeconds)
          ? { 'retry-after': String(Math.max(0, Math.ceil(result.retryAfterSeconds))) }
          : {},
    }
  return {
    status: Object.hasOwn(STATUS, result.code ?? '') ? STATUS[result.code!]! : 400,
    headers: {},
  }
}
