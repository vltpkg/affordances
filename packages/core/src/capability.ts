import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Expose } from '@affordances/protocol'
import type { ActionConfig, Ctx, Entities, GuardResult, StateDef } from './action.ts'
import { AffordancesError } from './errors.ts'

// Everything this file exports is @experimental: binding a capability from `@affordances/ir`, and checking it with
// `@affordances/runtime`, neither of which is published yet. Both may change before they are. Without a runtime,
// v0's agent path refuses a capability's declarative conditions (fail closed, rule 5)

// v0's config for the action a capability binds to
type Config<Output, Session, State extends Entities> = ActionConfig<
  StandardSchemaV1,
  Output,
  Session,
  State
>

// what defineAction needs from a capability made with @affordances/ir's defineCapability (RFC 0001 §12.1). Written
// structurally, so core takes no dependency on the IR package: a defined capability is plain data plus its schemas
type BoundCondition = { readonly id: string; readonly description: string } & (
  | { readonly guard: true }
  | { readonly expr: unknown }
)

// what defineAction needs from the projection runtime: its check, RFC 0002 §8.1's steps 1-7 without running.
// Written structurally too, so core takes no dependency on the runtime package
/** @experimental The projection runtime's principal (RFC 0002 §3), as the application resolves it for a call. */
export type CheckPrincipal = {
  readonly authenticated: boolean
  readonly subject?: string
  readonly attributes: Readonly<Record<string, unknown>>
}
/** @experimental What v0's agent path asks the projection runtime before it runs an action. */
export type CheckRequest = {
  principal: CheckPrincipal
  // the capability's id: the runtime names the target from the input at the capability's targetAt
  offer: string
  input?: unknown
  ifRevision?: string
  // only when v0's client confirmed the call: v0's confirmation, never an RFC 0002 approval
  confirmed?: { basis: 'v0-client-flag' }
}
/** @experimental The projection runtime's answer to a check. */
export type CheckResult =
  | { status: 'ok'; revision: string; confirmation?: { basis: 'v0-client-flag' } }
  | {
      status: 'refused'
      code:
        | 'not_found'
        | 'unauthorized'
        | 'rate_limited'
        | 'invalid_input'
        | 'precondition'
        | 'stale'
        | 'confirmation_required'
      condition?: { id: string; description: string }
      detail?: string
      detailTruncated?: true
      issues?: { at: string; message: string }[]
      confirmation?: { summary: string }
      revision: string
    }
/** @experimental The offers of a projection, as v0's graph listing reads them. In process only, never sent. */
export type ListedOffers = {
  readonly offers: readonly {
    readonly capability: string
    readonly availability: { readonly status: string; readonly because?: readonly string[] }
  }[]
}
/** @experimental The part of the projection runtime defineAction uses. */
export type CheckRuntime = {
  check(request: CheckRequest): Promise<CheckResult>
  project(request: { principal: CheckPrincipal; policy?: string }): Promise<ListedOffers>
}

/** @experimental See the note at the top of this file. */
export type BindableCapability<Guards extends string = string, Input = unknown> = {
  readonly definition: {
    readonly id: string
    readonly kind: 'query' | 'action' | 'event'
    readonly description: string
    // the target's resource type, and the JSON pointer into the input that names its key
    readonly target?: string
    readonly targetAt?: string
    readonly preconditions?: readonly BoundCondition[]
    readonly authorization?: {
      readonly principal: 'any' | 'authenticated'
      readonly conditions?: readonly BoundCondition[]
    }
    readonly confirmation?: { readonly summary: string }
  }
  readonly schemas: { readonly input?: StandardSchemaV1; readonly output?: StandardSchemaV1 }
  // the confirmation summary for an input, rendered by ir's one renderer when the capability requires confirmation
  readonly summary?: (input: unknown) => string
  readonly '~guards'?: Guards
  readonly '~input'?: Input
}

/** @experimental See the note at the top of this file. */
export type CapabilityGuards<C> = C extends { readonly '~guards'?: infer G }
  ? Exclude<G, undefined> & string
  : never
// a capability without input takes an empty object, as v0's z.object({}) does
/** @experimental See the note at the top of this file. */
export type CapabilityInput<C> = C extends { readonly '~input'?: infer I }
  ? [Exclude<I, undefined>] extends [never]
    ? Record<string, never>
    : Exclude<I, undefined>
  : never

/** @experimental See the note at the top of this file. */
export type GuardFn<Input, Session, State extends Entities> = (args: {
  // undefined when the graph is built, as for v0's guard
  input: Input | undefined
  state: State
  ctx: Ctx<Session>
}) => GuardResult | Promise<GuardResult>

// defineAction's form for a capability: the description, input, readOnly, requires and expose come from the
// capability, and this supplies only the code. A capability without guards takes no `guards`
/** @experimental See the note at the top of this file. */
export type CapabilityActionConfig<
  C extends BindableCapability,
  Output,
  Session,
  State extends Entities,
> = {
  capability: C
  // the route-local name v0's graph lists the action under
  name: string
  state?: StateDef<State>
  // v0's confirmation summary, as a function; otherwise the capability's own, rendered from the input by ir
  summary?: (args: { input: CapabilityInput<C>; state: State }) => string | Promise<string>
  message?: (args: { input: CapabilityInput<C>; output: Output }) => string
  effects?: (keyof State & string)[]
  run: (input: CapabilityInput<C>, ctx: Ctx<Session>) => Output | Promise<Output>
} & (
  | { runtime?: undefined; principal?: undefined }
  // the projection runtime evaluates the capability's conditions on v0's agent path (RFC 0001 §12.1), for the
  // principal the application resolves from v0's session
  | {
      runtime: CheckRuntime
      principal: (ctx: Ctx<Session>) => CheckPrincipal | Promise<CheckPrincipal>
    }
) &
  ([CapabilityGuards<C>] extends [never]
    ? { guards?: Record<string, never> }
    : // exactly one implementation per guard the capability declares (RFC 0001 §12.1, rule 5)
      { guards: { [K in CapabilityGuards<C>]: GuardFn<CapabilityInput<C>, Session, State> } })

// one projection per graph load, for every action it lists. Each load reads its state afresh, so the state object
// names the load: the graph after a call projects again
const listings = new WeakMap<object, Promise<ListedOffers>>()

const dev = () => process.env.NODE_ENV !== 'production'

// a capability without input takes none: v0 still validates something, so accept anything and pass {}
const NO_INPUT: StandardSchemaV1<unknown, Record<string, never>> & {
  '~standard': { jsonSchema: { input: () => Record<string, unknown> } }
} = {
  '~standard': {
    version: 1,
    vendor: 'affordances',
    validate: () => ({ value: {} }),
    jsonSchema: { input: () => ({ type: 'object', properties: {}, additionalProperties: false }) },
  },
}

// a capability with no declared authorization is never exposed: RFC 0002 §4.3 refuses it, so an agent could never
// run it, confirmation or not
const exposeOf = (def: BindableCapability['definition']): Expose | undefined =>
  !def.authorization
    ? undefined
    : def.confirmation
      ? 'confirm'
      : def.authorization?.principal === 'any'
        ? 'public'
        : def.authorization?.principal === 'authenticated'
          ? 'session'
          : undefined

// the v0 action config a capability binds to
export const fromCapability = <
  C extends BindableCapability,
  Output,
  Session,
  State extends Entities,
>(
  config: CapabilityActionConfig<C, Output, Session, State>,
): Config<Output, Session, State> => {
  const def = config.capability.definition
  if (def.kind === 'event')
    throw new TypeError(`${def.id} is an event: defineAction binds queries and actions`)
  const conditions = [...(def.authorization?.conditions ?? []), ...(def.preconditions ?? [])]
  const guardIds = conditions.filter((c) => 'guard' in c).map((c) => c.id)
  const declarative = conditions.filter((c) => !('guard' in c))
  const guards = (config.guards ?? {}) as Record<string, GuardFn<unknown, Session, State>>
  // the types require exactly these; a manifest loaded as JSON, or a cast, can still get them wrong
  const missing = guardIds.filter((id) => !(id in guards))
  const stray = Object.keys(guards).filter((id) => !guardIds.includes(id))
  if (missing.length || stray.length)
    throw new TypeError(
      `${config.name}: guards must implement exactly ${def.id}'s guards` +
        (missing.length ? `; missing ${missing.join(', ')}` : '') +
        (stray.length ? `; not declared: ${stray.join(', ')}` : ''),
    )

  const v0Guards = async (args: { input: unknown; state: State; ctx: Ctx<Session> }) => {
    // in declaration order, authorization's first; the first that doesn't pass is the answer, as v0's guard
    for (const id of guardIds) {
      const result = await guards[id]!(args)
      if (result !== true) return result
    }
    return true as const
  }

  // with a runtime, it evaluates every condition the capability declares before v0's own run (RFC 0001 §12.1)
  const runtime = config.runtime
  const principalOf = config.principal
  const described = conditions.map((c) => [c.id, c.description] as const)
  const reasonOf = (because: readonly string[] | undefined) =>
    (because ?? []).map((id) => described.find(([c]) => c === id)?.[1] ?? id).join('; ') ||
    `${def.id} is unavailable right now`

  const checked =
    runtime &&
    principalOf &&
    (async (args: {
      input: unknown
      state: State
      ctx: Ctx<Session>
      confirmed?: boolean
    }): Promise<GuardResult> => {
      // listing the graph, with no input: the offers' availability, from one projection per load. Only what's
      // settled closes an action: unavailable, or another principal's. Needs-input and unknown (a condition on the
      // input or a reference, which a start-less projection can't bind) stay open, as the graph is advice and the
      // call is checked
      if (args.input === undefined) {
        let listing = listings.get(args.state)
        if (!listing) {
          listing = Promise.resolve(principalOf(args.ctx)).then((principal) =>
            runtime.project({ principal, policy: 'exhaustive' }),
          )
          listings.set(args.state, listing)
        }
        const offers = (await listing).offers.filter((o) => o.capability === def.id)
        const open = ['available', 'needs-input', 'unknown']
        // no offer, nothing to say: the graph is advice, and the call is checked
        if (!offers.length || offers.some((o) => open.includes(o.availability.status)))
          return v0Guards(args)
        const first = offers[0]!.availability
        return first.status === 'needs-authorization'
          ? `${def.id} needs another principal`
          : reasonOf(first.because)
      }
      const result = await runtime.check({
        principal: await principalOf(args.ctx),
        offer: def.id,
        input: args.input,
        ...(args.confirmed && { confirmed: { basis: 'v0-client-flag' as const } }),
      })
      if (result.status === 'ok') return v0Guards(args)
      // v0's own confirm_required, with the summary, so the agent resends with confirm: true once approved
      if (result.code === 'confirmation_required')
        throw new AffordancesError(
          'confirm_required',
          result.confirmation?.summary ?? `Run ${config.name}`,
        )
      return (
        result.detail ?? result.condition?.description ?? `${def.id} was refused (${result.code})`
      )
    })

  // without a runtime, v0's handler has page state, not the resource attributes declarative conditions read, so it
  // can't evaluate them. Rule 5 says a declared precondition is enforced, so the agent path fails closed: it
  // refuses, naming each condition
  const unchecked =
    !checked && declarative.length
      ? `${declarative.map((c) => c.description).join('; ')}: can't be checked until the runtime serves ${def.id}`
      : undefined
  if (unchecked && dev())
    console.warn(
      `[affordances] ${config.name}: ${def.id} has declarative conditions (${declarative.map((c) => c.id).join(', ')}). Agents are refused until defineAction is given the runtime`,
    )

  const guard =
    checked || (unchecked ? async () => unchecked : guardIds.length ? v0Guards : undefined)
  if (!def.authorization && dev())
    console.warn(
      `[affordances] ${config.name}: ${def.id} declares no authorization, so agents can't reach it`,
    )
  const schema = config.capability.schemas.input ?? NO_INPUT
  const render = config.capability.summary
  return {
    // the capability's id, as the migration form's `id` carries it (RFC 0001 §10.1)
    id: def.id,
    name: config.name,
    description: def.description,
    input: schema,
    state: config.state,
    expose: exposeOf(def),
    requires: conditions.length ? conditions.map((c) => c.description).join('; ') : undefined,
    guard: guard as Config<Output, Session, State>['guard'],
    summary: (config.summary ??
      (render && (({ input }: { input: unknown }) => render(input)))) as Config<
      Output,
      Session,
      State
    >['summary'],
    message: config.message as Config<Output, Session, State>['message'],
    effects: config.effects,
    readOnly: def.kind === 'query' || undefined,
    output: config.capability.schemas.output,
    run: config.run as Config<Output, Session, State>['run'],
  }
}
