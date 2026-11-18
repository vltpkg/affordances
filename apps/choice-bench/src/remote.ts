import type {
  Budget,
  ExecutionRequest,
  ExecutionResult,
  Expansion,
  OfferDetails,
  Projection,
  ProjectionRequest,
  View,
} from '@affordances/runtime'

// a TEST-HARNESS client only (the planner, 2026-11-18 14:10Z): the runtime calls the benchmark's tools make, over a
// hosting-lab server's protocol-1 endpoints (RFC 0004 §2) with the trial's own session, so every surface shares one
// server, one store per session and one outcome read. It hands the agent's tools the approval token, as M5's tools
// do (surfaces/PLAN.md §3's approval column), which is why it lives here and in no package

type Fetch = (input: string, init?: RequestInit) => Promise<Response>
/** The part of a runtime the benchmark's tools use, over HTTP. */
export type RemoteRuntime = {
  project(request: ProjectionRequest): Promise<Projection>
  execute(request: ExecutionRequest): Promise<ExecutionResult>
}

// a projection request as the route's parameters: start as type:key, task as its statement, offers from the budget
const paramsOf = (r: Omit<ProjectionRequest, 'principal'>) => {
  if (r.bind?.length)
    throw new Error('the protocol-1 route has no bind: a surface trial starts from the project')
  const start =
    r.start === undefined
      ? undefined
      : typeof r.start === 'string'
        ? r.start
        : `${r.start.type}:${r.start.key}`
  return {
    ...(r.policy && { policy: r.policy }),
    ...(start && { start }),
    ...(r.seen && { seen: r.seen }),
    ...(r.task && { task: r.task.statement }),
    ...(r.budget?.offers !== undefined && { offers: String(r.budget.offers) }),
  }
}

export const remoteRuntime = (options: {
  base: string
  session: string
  fetch?: Fetch
}): RemoteRuntime => {
  const fetcher: Fetch = options.fetch ?? fetch
  const headers = { authorization: `Bearer ${options.session}` }
  const get = async <T>(path: string, params: Record<string, string>) => {
    const response = await fetcher(`${options.base}${path}?${new URLSearchParams(params)}`, {
      headers,
    })
    const body = (await response.json()) as T & { error?: string }
    if (!response.ok && body.error) throw new Error(body.error)
    return body
  }
  const post = async <T>(path: string, body: unknown) => {
    const response = await fetcher(`${options.base}${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { ...headers, 'content-type': 'application/json' },
    })
    const out = (await response.json()) as T & { error?: string }
    // a runtime refusal is a result with a status; anything else that isn't ok is the route's own error
    if (!response.ok && out.error && !('status' in (out as object))) throw new Error(out.error)
    return out
  }
  return {
    project: async (request) => {
      const { principal: _, ...rest } = request
      const params = paramsOf(rest)
      const view = await get<View>('/view', params)
      return {
        revision: view.revision,
        view: () => view,
        expand: (expansion: Pick<Expansion, 'from' | 'along'>, opts?: { budget?: Budget }) =>
          post<View>('/expand', {
            ...params,
            ...expansion,
            ...(opts?.budget && { budget: opts.budget }),
          }),
        inspect: (offer: string) => get<OfferDetails>('/inspect', { ...params, offer }),
      } as unknown as Projection
    },
    execute: async (request) => {
      const {
        principal: _,
        view,
        ...call
      } = request as ExecutionRequest & { view?: Omit<ProjectionRequest, 'principal'> }
      return post<ExecutionResult>('/execute', { ...call, ...(view && paramsOf(view)) })
    },
  }
}
