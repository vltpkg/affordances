import {
  Call,
  MEDIA_TYPE,
  PROTOCOL_VERSION,
  WELL_KNOWN_PATH,
  type ActionDescriptor,
  type ActionSummary,
  type Delta,
  type ErrorCode,
  type Graph,
  type SiteIndex,
} from '@affordances/protocol'
import {
  AFFORDANCES,
  validate,
  type AnyAction,
  type AnyState,
  type Auth,
  type Ctx,
} from './action.ts'
import { AffordancesError, RedirectSignal } from './errors.ts'
import { compile, match, sort } from './route.ts'

export type Manifest = {
  name?: string
  mcp?: string
  // route pattern → its state and actions, e.g. '/products/[slug]': { state, actions: [addToCart] }
  routes: Record<string, { state?: AnyState; actions: AnyAction[] }>
}

export type HandlerOptions = {
  manifest: Manifest
  // stripped from the request path before matching, e.g. '/api/affordances' when a proxy rewrites there
  basePath?: string
  // defaults to the auth the actions were defined with (createAffordances)
  auth?: Auth<unknown>
  // true to allow; a number is seconds until the caller may retry
  rateLimit?: (args: {
    request: Request
    action: string
    session: unknown
  }) => true | number | Promise<true | number>
  // origins besides the request's own that may make cookie-authenticated calls
  allowedOrigins?: string[]
  // the path a framework's own redirect error points to (e.g. next's redirect()), or undefined if it isn't one
  redirectFrom?: (error: unknown) => string | undefined
}

const status: Record<ErrorCode, number> = {
  not_found: 404,
  invalid_input: 422,
  unauthorized: 401,
  confirm_required: 409,
  unavailable: 409,
  rate_limited: 429,
  internal: 500,
}

const headers = {
  'content-type': MEDIA_TYPE,
  'cache-control': 'private, no-store',
  vary: 'Accept',
}

const json = (body: Graph | Delta | SiteIndex, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: { ...headers, ...init.headers } })

const fail = (error: AffordancesError, init: ResponseInit = {}) =>
  json(
    {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.issues !== undefined && { issues: error.issues }),
      },
    },
    { status: status[error.code], ...init },
  )

const exposed = (actions: AnyAction[]) => actions.filter((action) => action[AFFORDANCES].expose)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// an action as the site index lists it: everything but this request's availability
const summarize = (action: AnyAction): ActionSummary => {
  const meta = action[AFFORDANCES]
  return {
    name: meta.name,
    description: meta.description,
    input: meta.jsonSchema,
    ...(meta.outputSchema && { output: meta.outputSchema }),
    expose: meta.expose!,
    ...(meta.requires && { guard: meta.requires }),
    ...(meta.effects && { effects: meta.effects }),
    ...(meta.readOnly && { readOnly: true }),
  }
}

const describe = async (
  action: AnyAction,
  state: Record<string, unknown>,
  ctx: Ctx,
): Promise<ActionDescriptor> => {
  const meta = action[AFFORDANCES]
  const descriptor: ActionDescriptor = { ...summarize(action), available: true }
  if (meta.expose !== 'public' && !ctx.session)
    return { ...descriptor, available: false, reason: 'Requires a session' }
  const result = meta.guard ? await meta.guard({ input: undefined, state, ctx }) : true
  return result === true
    ? descriptor
    : { ...descriptor, available: false, ...(result && { reason: result }) }
}

export const createHandler = (options: HandlerOptions) => {
  const { manifest, basePath = '' } = options
  const routes = sort(Object.keys(manifest.routes).map(compile))
  const allActions = Object.values(manifest.routes).flatMap((route) => route.actions)
  const auth =
    options.auth ?? allActions.find((action) => action[AFFORDANCES].auth)?.[AFFORDANCES].auth

  const resolve = (path: string) => {
    for (const route of routes) {
      const params = match(route, path)
      if (params) return { pattern: route.pattern, params, ...manifest.routes[route.pattern]! }
    }
  }

  const load = async (route: NonNullable<ReturnType<typeof resolve>>, url: URL, ctx: Ctx) => {
    const searchParams = new URLSearchParams(url.searchParams)
    searchParams.delete('affordances')
    const state = (await route.state?.load({ params: route.params, searchParams, ctx })) ?? {}
    const actions = await Promise.all(exposed(route.actions).map((a) => describe(a, state, ctx)))
    return { state, actions }
  }

  const siteIndex = (): SiteIndex => ({
    v: PROTOCOL_VERSION,
    ...(manifest.name && { name: manifest.name }),
    // every route with its actions' static descriptors, so an agent can plan, and call, without opening pages
    routes: Object.entries(manifest.routes).map(([route, { state, actions }]) => ({
      route,
      ...(state?.description && { description: state.description }),
      actions: exposed(actions).map(summarize),
    })),
    auth: ['cookie', 'bearer'],
    ...(manifest.mcp && { mcp: manifest.mcp }),
  })

  const call = async (
    request: Request,
    route: NonNullable<ReturnType<typeof resolve>>,
    url: URL,
    ctx: Ctx,
  ) => {
    // 1. resolve
    const body = Call.safeParse(await request.json().catch(() => undefined))
    if (!body.success)
      throw new AffordancesError('invalid_input', 'Body must be { action, input?, confirm? }')
    const action = exposed(route.actions).find((a) => a[AFFORDANCES].name === body.data.action)
    if (!action)
      throw new AffordancesError(
        'not_found',
        `No action named ${body.data.action} on ${route.pattern}`,
      )
    const meta = action[AFFORDANCES]

    // 2. csrf + expose: a cookie-authenticated call has to come from the site (or an allowed origin)
    const bearer = request.headers.get('authorization')?.startsWith('Bearer ')
    if (!bearer && request.headers.has('cookie')) {
      const origin = request.headers.get('origin')
      if (!origin || ![url.origin, ...(options.allowedOrigins ?? [])].includes(origin))
        throw new AffordancesError(
          'unauthorized',
          'Cookie-authenticated calls need a matching Origin header, or use a bearer token',
        )
    }
    if (meta.expose !== 'public' && !ctx.session)
      throw new AffordancesError('unauthorized', `${meta.name} requires a session`)

    // 3. rate limit
    const limit = await options.rateLimit?.({ request, action: meta.name, session: ctx.session })
    if (typeof limit === 'number')
      return fail(
        new AffordancesError('rate_limited', `Too many calls to ${meta.name}; retry in ${limit}s`),
        {
          headers: { 'retry-after': String(limit) },
        },
      )

    // 4. validate, 5. guard
    const input = await validate(meta.input, body.data.input)
    const before = await load(route, url, ctx)
    const guard = meta.guard ? await meta.guard({ input, state: before.state, ctx }) : true
    if (guard !== true)
      throw new AffordancesError('unavailable', guard || `${meta.name} is unavailable right now`)

    // 6. confirm
    if (meta.expose === 'confirm' && body.data.confirm !== true)
      throw new AffordancesError(
        'confirm_required',
        // only the summary: confirm_required itself tells the agent to resend with confirm: true once approved
        (await meta.summary?.({ input, state: before.state })) ?? `Run ${meta.name}`,
      )

    // 7. run, reload, diff
    let output: unknown
    let redirect: string | undefined
    try {
      output = await meta.run(input, ctx)
    } catch (error) {
      redirect = error instanceof RedirectSignal ? error.to : options.redirectFrom?.(error)
      if (!redirect) throw error
    }
    const after = await load(route, url, ctx)
    const keys =
      meta.effects ??
      [...new Set([...Object.keys(before.state), ...Object.keys(after.state)])].filter(
        (key) => !same(before.state[key], after.state[key]),
      )
    const changed = Object.fromEntries(keys.map((key) => [key, after.state[key]]))
    const previous = new Map(before.actions.map((a) => [a.name, a]))
    const actionsAdded = after.actions.filter((a) => !same(previous.get(a.name), a))
    const names = new Set(after.actions.map((a) => a.name))
    const actionsRemoved = before.actions.filter((a) => !names.has(a.name)).map((a) => a.name)

    return json({
      ok: true,
      ...(keys.length && { changed }),
      ...(output !== undefined && { output }),
      ...(actionsAdded.length && { actionsAdded }),
      ...(actionsRemoved.length && { actionsRemoved }),
      ...(redirect && { redirect }),
      ...(meta.message && { message: meta.message({ input, output }) }),
    })
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname.startsWith(basePath)
      ? url.pathname.slice(basePath.length) || '/'
      : url.pathname
    try {
      if (request.method === 'GET' && path === WELL_KNOWN_PATH) return json(siteIndex())
      const route = resolve(path)
      if (!route) throw new AffordancesError('not_found', `No Affordances graph for ${path}`)
      const session = auth ? await auth(request) : null
      const ctx: Ctx = { session, request, via: 'agent' }

      if (request.method === 'GET') {
        const { state, actions } = await load(route, url, ctx)
        return json({
          v: PROTOCOL_VERSION,
          page: path,
          route: route.pattern,
          entities: state,
          actions,
          ...(route.state?.nav && { nav: route.state.nav(state) }),
        })
      }
      if (request.method === 'POST') return await call(request, route, url, ctx)
      return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
    } catch (error) {
      if (error instanceof AffordancesError) return fail(error)
      console.error('[affordances]', error)
      return fail(new AffordancesError('internal', 'Something went wrong'))
    }
  }
}
