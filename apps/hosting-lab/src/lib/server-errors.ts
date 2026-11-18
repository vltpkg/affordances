import { recordServerError } from './store.ts'

// a route handler whose 5xx answers are counted for a trial (src/lib/store.ts, recordServerError). The response is
// returned as it was; without a trial's state file, nothing is recorded. A thrown error is Next's, and
// src/instrumentation.ts counts it
export const countingErrors =
  <A extends unknown[]>(
    route: string,
    handler: (request: Request, ...rest: A) => Promise<Response> | Response,
  ) =>
  async (request: Request, ...rest: A): Promise<Response> => {
    const response = await handler(request, ...rest)
    if (response.status >= 500) recordServerError(response.status, route)
    return response
  }
