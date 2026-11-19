// Next's hook for an error it caught rendering a page or running a route, which it answers with a 500: counted for a
// trial's stall rule (src/lib/store.ts, recordServerError), and only when the trial env set a state file. The
// returned 5xx answers are src/lib/server-errors.ts's
export const onRequestError = async (
  _error: unknown,
  request: { path: string },
  context: { routePath?: string },
) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { recordServerError } = await import('./lib/store.ts')
  recordServerError(500, context.routePath ?? request.path)
}
