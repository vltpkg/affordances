import type { ErrorCode } from '@afford/protocol'

// throw from run() or a guard to answer with a specific protocol error
export class AffordError extends Error {
  code: ErrorCode
  issues?: unknown
  constructor(code: ErrorCode, message: string, extra: { issues?: unknown } = {}) {
    super(message)
    this.name = 'AffordError'
    this.code = code
    this.issues = extra.issues
  }
}

export class RedirectSignal extends Error {
  to: string
  constructor(to: string) {
    super(`redirect to ${to}`)
    this.to = to
  }
}

// ends the action and sends the caller to `to`: a delta's `redirect` for agents, the framework's redirect for people
export const redirect = (to: string): never => {
  throw new RedirectSignal(to)
}
