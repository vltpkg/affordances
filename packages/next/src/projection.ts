import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  Budget,
  Expansion,
  Handler,
  Principal,
  ProjectionRequest,
  RefusalCode,
  ResourceResolver,
  TokenStore,
} from '@affordances/runtime'
import { PROTOCOL_1_MEDIA_TYPE } from './constants.ts'

// RFC 0005 §5's projection route: serves RFC 0002's views from the compiled manifest, with the app's resolvers and the
// handlers bindings.ts names. @affordances/runtime is next's optional peer, and only this entry
// imports it, as a bare import the app resolves. The surface is hosting-lab's (apps/hosting-lab/src/lib/serve.ts),
// @experimental until RFC 0004 fixes the wire: views only, never a projection; an Origin check for cookie calls; per-
// caller caching; and RFC 0004 §2.3's statuses, from the runtime's statusOf

/** @experimental One entry of bindings.ts: the v0 action that implements a capability, and how to call it. */
export type ProjectionBinding = {
  action: unknown
  route: string
  name: string
  params: Record<string, { from: 'target' }>
  guards: Record<string, unknown>
}

/** @experimental What createProjectionRoute takes. */
export type ProjectionRouteOptions<Session = unknown> = {
  // .affordances/manifest.json and .affordances/bindings.ts, as the app imports them
  manifest: unknown
  bindings: Record<string, ProjectionBinding>
  /**
   * @experimental The runtime's handlers, by capability id, used instead of those built from bindings: for an app that
   * implements its capabilities for the runtime directly, rather than through bound v0 actions
   */
  handlers?: Record<string, Handler>
  resources: Record<string, ResourceResolver>
  // the caller, from the request's one credential (RFC 0004 §2.3)
  principal: (request: Request) => Principal | Promise<Principal>
  // v0's session, for the actions' own run and guard, which take v0's context
  session?: (request: Request) => Session | null | Promise<Session | null>
  // approval tokens (RFC 0002 §8.2): an HMAC key and a single-use store of the nonces spent, shared by every instance.
  // Required unless NODE_ENV is development or test, where they default to a key per process and an in-memory store
  approvalKey?: CryptoKey
  seenTokens?: TokenStore
  /**
   * @experimental The app's own runtime, served as it is, so the route and the app's other pages share one: its
   * manifest, resolvers, handlers and approval keys are then the runtime's, and the options for them go unread. The
   * route's approval gate doesn't apply then, so keeping the runtime's approval key and token store shared by every
   * instance, as the gate would require, becomes the app's job
   */
  runtime?: RuntimeInstance
  /**
   * Origins a cookie-authenticated POST may also come from, each compared exactly (scheme, host and port): for a
   * reverse proxy, or another host name the site is reached by. The request's own origin always counts. Forwarded
   * headers (X-Forwarded-Host, X-Forwarded-Proto) are never read, so a proxy's public origin is listed here
   */
  allowedOrigins?: readonly string[]
}

// @affordances/runtime, next's optional peer: imported on the first request, so a missing peer is one error that
// names it. Next's bundler resolves the import at build time, and its own error names the package too
type Runtime = typeof import('@affordances/runtime')
type RuntimeInstance = ReturnType<Runtime['createRuntime']>
let loaded: Promise<Runtime> | undefined
const loadRuntime = () =>
  (loaded ??= import('@affordances/runtime').catch((error: unknown) => {
    loaded = undefined
    if (
      // only when runtime itself is what's missing: an installed runtime's own missing import names runtime's path
      // too, and is rethrown as it is
      (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
      /Cannot find (package|module) '@affordances\/runtime'/.test((error as Error).message)
    )
      throw new Error(
        "@affordances/next/projection needs @affordances/runtime, next's optional peer: install it beside @affordances/next",
        { cause: error },
      )
    throw error
  }))

// what a request's handlers need, which the runtime's handler signature doesn't carry
const current = new AsyncLocalStorage<{ request: Request; session: unknown }>()

// v0's context for an action the runtime runs: the request's session, on the agent path
const v0Context = () => {
  const c = current.getStore()
  return { session: c?.session ?? null, request: c?.request, via: 'agent' as const }
}

// the projection operation a request names: the route's last path segment (inspect, expand, execute), else the view
const operation = (request: Request) =>
  new URL(request.url).pathname.split('/').filter(Boolean).at(-1)

// v0's definition on a defineAction export, by core's own symbol
type V0 = {
  run: (input: unknown, ctx: unknown) => unknown
  guard?: (args: unknown) => unknown
  state?: { load: (args: unknown) => unknown }
}
const v0Of = (action: unknown): V0 | undefined =>
  (action as Record<symbol, V0> | undefined)?.[Symbol.for('affordances.action')]

// the route's params as v0's page would have them: each from the call's target (RFC 0005 §4)
const paramsOf = (b: ProjectionBinding, target?: { key: string }) =>
  Object.fromEntries(
    Object.entries(b.params).flatMap(([name, p]) =>
      p.from === 'target' && target ? [[name, target.key]] : [],
    ),
  )

/** @experimental The runtime handlers a bindings.ts names: each runs its v0 action, with v0's context (RFC 0005 §4). */
export const handlersOf = (bindings: Record<string, ProjectionBinding>): Record<string, Handler> =>
  Object.fromEntries(
    Object.entries(bindings).flatMap(([id, b]) => {
      const meta = v0Of(b.action)
      if (!meta) return []
      const handler: Handler = { run: (input) => meta.run(input, v0Context()) }
      // E7's opaque guard condition, by the action's own guard, against its route's state
      if (Object.keys(b.guards).length && meta.guard)
        handler.guards = {
          guard: async ({ input, target }) => {
            const params = paramsOf(b, target)
            const state = meta.state
              ? await meta.state.load({
                  params,
                  searchParams: new URLSearchParams(),
                  ctx: v0Context(),
                })
              : {}
            const result = await meta.guard!({ input, state, ctx: v0Context() })
            return result === true ? true : typeof result === 'string' ? result : false
          },
        }
      return [[id, handler]]
    }),
  )

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    // per caller, and never cached by anything shared
    headers: {
      'content-type': PROTOCOL_1_MEDIA_TYPE,
      'cache-control': 'private, no-store',
      vary: 'Authorization, Cookie',
      ...extra,
    },
  })
// a refusal made before the runtime, in the runtime's shape (RFC 0004 §2.3): the Origin's 403 is
// unauthorized, a malformed body's 400 is invalid_input (the schema's own is 422), and a missing offer or operation's
// 404 is not_found
const REFUSED_AS: Record<number, RefusalCode> = {
  400: 'invalid_input',
  403: 'unauthorized',
  404: 'not_found',
}
const refuse = (status: 400 | 403 | 404, detail: string) =>
  json({ status: 'refused', code: REFUSED_AS[status], detail }, status)

// the request's own origin: the scheme the server received it on, and the host and port the client addressed, from
// its Host header as Next receives it. request.url's host is the server's own idea of its name (under next start,
// localhost), so a same-origin call through 127.0.0.1 or any other name wouldn't match it. Without a Host header, as
// in a direct handler call, request.url's host stands in
const ownOrigin = (request: Request) => {
  const url = new URL(request.url)
  const host = request.headers.get('host')
  if (!host) return url.origin
  try {
    return new URL(`${url.protocol}//${host}`).origin
  } catch {
    // a Host that isn't a host is no origin at all
    return undefined
  }
}

// the token a bearer header names, when it names exactly one: `Bearer `, `Bearer a b` and other schemes name none
const bearerOf = (request: Request) =>
  request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]

/**
 * @experimental RFC 0004 §2.3's one credential parser, for an app's `principal`: the token a bearer header names, else
 * the value of the app's session cookie. A bearer header that names no single token authenticates nothing, so the
 * cookie does, and the cookie's rules (the Origin check) apply.
 */
export const credentialOf = (
  request: Request,
  cookie: string,
): { token: string; via: 'bearer' | 'cookie' } | { token: null; via: null } => {
  const bearer = bearerOf(request)
  if (bearer) return { token: bearer, via: 'bearer' }
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${cookie}=`))
    ?.slice(cookie.length + 1)
  return value ? { token: value, via: 'cookie' } : { token: null, via: null }
}

// RFC 0004 §2.3's one credential parser: a bearer header naming one token, else the cookie. A POST the cookie
// authenticates must carry the site's Origin, compared exactly, or one the app allows; a bearer call is exempt. A
// missing Origin, or 'null', is refused. A cross-site page can forge neither Origin nor Host, so this is the standard
// CSRF check. A DNS-rebound name matches itself, but the browser sends it no cookie scoped to the real host, so cookie
// authentication isn't exposed; and a browser never sends a bearer on its own
const crossSite = (request: Request, allowed: ReadonlySet<string>): Response | undefined => {
  if (bearerOf(request)) return
  if (!request.headers.get('cookie')) return
  const origin = request.headers.get('origin')
  if (origin && origin !== 'null' && (origin === ownOrigin(request) || allowed.has(origin))) return
  return refuse(
    403,
    'Cookie-authenticated calls need a matching Origin header, or use a bearer token',
  )
}

// a budget's limit, on the view's query and in an expansion's body alike
const positiveWhole = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0

type Params = Record<string, unknown>

// the runtime's approval gate, word for word (see createProjectionRoute)
const approvalGate = (caller: string, given: { approvalKey?: unknown; seenTokens?: unknown }) => {
  const env = process.env.NODE_ENV
  if (env === 'development' || env === 'test') return
  const missing = [!given.approvalKey && 'approvalKey', !given.seenTokens && 'seenTokens'].filter(
    Boolean,
  )
  if (missing.length)
    throw new Error(
      `${caller} needs ${missing.join(' and ')} unless NODE_ENV is development or test: an HMAC approvalKey ` +
        'shared by every instance, and a seenTokens store every instance shares, whose claim(nonce, expiresAt) is ' +
        'single-use, such as a database or KV with a TTL of at least the approval expiry',
    )
}

/** @experimental A Next route serving the app's views, inspections, checks and executions (RFC 0005 §5; RFC 0004 §2). */
export const createProjectionRoute = <Session = unknown>(
  options: ProjectionRouteOptions<Session>,
) => {
  // each an origin as the browser sends it, so the comparison stays exact: no path, no trailing slash
  for (const o of options.allowedOrigins ?? []) {
    let origin: string | undefined
    try {
      origin = new URL(o).origin
    } catch {}
    if (origin !== o)
      throw new TypeError(`allowedOrigins: ${o} isn't an origin, as in https://example.com`)
  }
  const allowedOrigins: ReadonlySet<string> = new Set(options.allowedOrigins)
  // the runtime's approval gate (its approvalGate), kept here because the runtime is loaded only on the first request
  // and the gate holds when the route is made. A test holds the two texts equal
  // a runtime the app made holds its own keys: createRuntime refused it without them, wherever a capability confirms
  if (!options.runtime) approvalGate('createProjectionRoute', options)
  // made once, on the first request, as one promise, so concurrent first requests share one runtime and its approval
  // key: createRuntime finds the manifest's facts once (derive, edges, schemas)
  let made:
    | Promise<{
        rt: ReturnType<Runtime['createRuntime']>
        statusOf: Runtime['statusOf']
        policies: Set<string>
        along: Runtime['ALONG']
        decodeStart: Runtime['decodeStart']
      }>
    | undefined
  const runtime = () =>
    (made ??= make().catch((error: unknown) => {
      made = undefined
      throw error
    }))
  const make = async () => {
    const {
      createRuntime,
      statusOf,
      builtInPolicies,
      devApprovalKey,
      memoryTokenStore,
      ALONG,
      decodeStart,
    } = await loadRuntime()
    const rt =
      options.runtime ??
      createRuntime({
        manifest: options.manifest as never,
        resources: options.resources,
        handlers: options.handlers ?? handlersOf(options.bindings),
        approvalKeys: { current: options.approvalKey ?? (await devApprovalKey()) },
        seenTokens: options.seenTokens ?? memoryTokenStore(),
      })
    return {
      rt,
      statusOf,
      policies: new Set(builtInPolicies.map((p) => p.id)),
      along: ALONG,
      decodeStart,
    }
  }

  const projectionOf = async (request: Request, p: Params): Promise<ProjectionRequest | string> => {
    const policy = typeof p.policy === 'string' && p.policy ? p.policy : undefined
    const { policies, decodeStart } = await runtime()
    if (policy && !policies.has(policy))
      return `No policy ${policy}: one of ${[...policies].join(', ')}`
    const offers = p.offers === undefined || p.offers === '' ? undefined : Number(p.offers)
    if (offers !== undefined && !positiveWhole(offers)) return 'offers is a positive whole number'
    // a start that isn't one is refused, never read as no start (hosting-lab's route, on moving here)
    if (p.start !== undefined && (typeof p.start !== 'string' || !p.start))
      return 'start is type:key, or a capability or resource type id'
    return {
      principal: await options.principal(request),
      start: decodeStart(p.start),
      policy,
      seen: typeof p.seen === 'string' && p.seen ? p.seen : undefined,
      task: typeof p.task === 'string' && p.task ? { statement: p.task } : undefined,
      budget: offers === undefined ? undefined : { offers },
    }
  }
  // every call runs with its request and v0 session at hand, for the handlers
  const within = async <T>(request: Request, f: () => Promise<T>) =>
    current.run({ request, session: (await options.session?.(request)) ?? null }, f)

  const GET = (request: Request): Promise<Response> =>
    within(request, async () => {
      const params = Object.fromEntries(new URL(request.url).searchParams) as Params
      const p = await projectionOf(request, params)
      if (typeof p === 'string') return refuse(400, p)
      const projection = await (await runtime()).rt.project(p)
      if (operation(request) !== 'inspect') return json(projection.view())
      const offer = params.offer
      if (typeof offer !== 'string' || !offer) return refuse(400, 'offer is an offer id')
      try {
        return json(await projection.inspect(offer))
      } catch {
        // an offer the principal may not see answers as one that doesn't exist
        return refuse(404, `No offer ${offer}`)
      }
    })

  const POST = (request: Request): Promise<Response> =>
    within(request, async () => {
      const refused = crossSite(request, allowedOrigins)
      if (refused) return refused
      const body = (await request.json().catch(() => undefined)) as Params | undefined
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return refuse(400, 'The body is a JSON object')
      const p = await projectionOf(request, body)
      if (typeof p === 'string') return refuse(400, p)
      const { rt, statusOf, along: ALONG } = await runtime()
      const op = operation(request)
      if (op === 'expand') {
        const { from, along, budget } = body
        const fromOk =
          typeof from === 'string' ||
          (from !== null && typeof from === 'object' && 'type' in from && 'key' in from)
        if (!fromOk)
          return refuse(
            400,
            'from is an offer id, a choice set id, a more cursor, or { type, key }',
          )
        if (typeof along !== 'string' || !(ALONG as readonly string[]).includes(along))
          return refuse(400, `along is one of ${ALONG.join(', ')}`)
        // the view's rule: offers and facts, each a positive whole number, and nothing else
        if (
          budget !== undefined &&
          (budget === null ||
            typeof budget !== 'object' ||
            Array.isArray(budget) ||
            Object.entries(budget).some(
              ([k, v]) => !(k === 'offers' || k === 'facts') || !positiveWhole(v),
            ))
        )
          return refuse(400, 'budget is { offers?, facts? }, each a positive whole number')
        try {
          const step = { from: from as Expansion['from'], along: along as Expansion['along'] }
          return json(
            await (await rt.project(p)).expand(step, { budget: budget as Budget | undefined }),
          )
        } catch (error) {
          return refuse(400, (error as Error).message)
        }
      }
      if (op === 'execute') {
        const { offer, input, approval, ifRevision } = body
        if (typeof offer !== 'string' || !offer) return refuse(400, 'offer is an offer id')
        if (approval !== undefined && typeof approval !== 'string')
          return refuse(400, 'approval is a token')
        if (ifRevision !== undefined && typeof ifRevision !== 'string')
          return refuse(400, 'ifRevision is an offer revision')
        const { principal, ...view } = p
        const result = await rt.execute({
          principal,
          offer,
          input,
          approval: approval as string | undefined,
          ifRevision: ifRevision as string | undefined,
          view,
        } as never)
        const { status, headers } = statusOf(result, principal)
        return json(result, status, headers)
      }
      // RFC 0004 §2's check: RFC 0002 §8.1's steps 1 to 7, without running. It never issues or accepts a token, and a v0
      // client's confirmed flag isn't something a caller here can set (RFC 0001 §12.1)
      if (op === 'check') {
        const { offer, input, ifRevision } = body
        if (typeof offer !== 'string' || !offer) return refuse(400, 'offer is an offer id')
        if (ifRevision !== undefined && typeof ifRevision !== 'string')
          return refuse(400, 'ifRevision is an offer revision')
        const { principal } = p
        const result = await rt.check({
          principal,
          offer,
          input,
          ifRevision: ifRevision as string | undefined,
        } as never)
        if (result.status === 'ok') return json(result)
        // a refusal, with nothing of a token: the runtime's check never issues one, so its confirmation is the summary
        const { status, headers } = statusOf(result as never, principal)
        return json(result, status, headers)
      }
      return refuse(404, `No projection operation ${op}`)
    })

  return { GET, POST }
}
