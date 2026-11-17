import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Expose } from '@affordances/protocol'
import type { ActionConfig, Ctx, Entities, GuardResult, StateDef } from './action.ts'
import { AffordancesError } from './errors.ts'

// what defineAction needs from a capability made with @affordances/ir's defineCapability (RFC 0001 §12.1). Written
// structurally, so core takes no dependency on the IR package: a defined capability is plain data plus its schemas
type BoundCondition = { readonly id: string; readonly description: string } & (
  | { readonly guard: true }
  | { readonly expr: unknown }
)

// what defineAction needs from the projection runtime: its check, RFC 0002 §8.1's steps 1-7 without running.
// Written structurally too, so core takes no dependency on the runtime package
/**
 * @experimental The projection runtime's principal (RFC 0002 §3), as the application resolves it for a call.
 */
export type CheckPrincipal = {
  readonly authenticated: boolean
  readonly subject?: string
  readonly attributes: Readonly<Record<string, unknown>>
}
/**
 * @experimental What v0's agent path asks the projection runtime before it runs an action.
 */
export type CheckRequest = {
  principal: CheckPrincipal
  // `capability@type:key`, or the capability's id when it has no target
  offer: string
  input?: unknown
  ifRevision?: string
  // only when v0's client confirmed the call: v0's confirmation, never an RFC 0002 approval
  confirmed?: { basis: 'v0-client-flag' }
}
/**
 * @experimental The projection runtime's answer to a check.
 */
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
/**
 * @experimental The part of the projection runtime defineAction uses.
 */
export type CheckRuntime = { check(request: CheckRequest): Promise<CheckResult> }

/**
 * @experimental Binding a capability from `@affordances/ir`, which isn't published yet. It may change before it is,
 * and its fail-closed refusal on v0's agent path is interim (M3d).
 */
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
  readonly '~guards'?: Guards
  readonly '~input'?: Input
}

/**
 * @experimental Binding a capability from `@affordances/ir`, which isn't published yet. It may change before it is,
 * and its fail-closed refusal on v0's agent path is interim (M3d).
 */
export type CapabilityGuards<C> = C extends { readonly '~guards'?: infer G }
  ? Exclude<G, undefined> & string
  : never
// a capability without input takes an empty object, as v0's z.object({}) does
/**
 * @experimental Binding a capability from `@affordances/ir`, which isn't published yet. It may change before it is,
 * and its fail-closed refusal on v0's agent path is interim (M3d).
 */
export type CapabilityInput<C> = C extends { readonly '~input'?: infer I }
  ? [Exclude<I, undefined>] extends [never]
    ? Record<string, never>
    : Exclude<I, undefined>
  : never

/**
 * @experimental Binding a capability from `@affordances/ir`, which isn't published yet. It may change before it is,
 * and its fail-closed refusal on v0's agent path is interim (M3d).
 */
export type GuardFn<Input, Session, State extends Entities> = (args: {
  // undefined when the graph is built, as for v0's guard
  input: Input | undefined
  state: State
  ctx: Ctx<Session>
}) => GuardResult | Promise<GuardResult>

// defineAction's form for a capability: the description, input, readOnly, requires and expose come from the
// capability, and this supplies only the code. A capability without guards takes no `guards`
/**
 * @experimental Binding a capability from `@affordances/ir`, which isn't published yet. It may change before it is,
 * and its fail-closed refusal on v0's agent path is interim (M3d).
 */
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
  // v0's confirmation summary, as a function; otherwise the capability's template is filled in from the input
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

// the agent calls whose v0 client set confirm: true, by their ctx. The handler marks a call before its guard runs,
// so the check can say v0 confirmed it without the guard's public arguments changing
export const confirmedCalls = new WeakSet<object>()

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

// a JSON pointer's reference tokens (RFC 6901)
const tokens = (pointer: string) =>
  pointer
    .split('/')
    .slice(1)
    .map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~'))

// whether a condition's expression reads the input: listing without one, such a condition can't be settled
const readsInput = (expr: unknown): boolean =>
  Array.isArray(expr)
    ? expr.some(readsInput)
    : expr !== null && typeof expr === 'object'
      ? Object.entries(expr).some(([k, v]) =>
          k === 'path' && typeof v === 'string'
            ? v === 'input' || v.startsWith('input.')
            : readsInput(v),
        )
      : false

const at = (value: unknown, path: string[]) =>
  path.reduce<unknown>(
    (v, key) =>
      v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined,
    value,
  )

// RFC 8785's JSON text, for a value in a summary: object members sorted by UTF-16 code units
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
          .toSorted()
          .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(value)

// the capability's `{path}` template (RFC 0001 §3.2): a string as written, any other value as its JSON text. v0 has only the input, so other roots read "unknown",
// as an unresolved placeholder does; `{{` and `}}` are literal braces
const fill = (template: string, input: unknown) =>
  template.replace(/\{\{|\}\}|\{([A-Za-z0-9_.]+)\}/g, (match, path: string | undefined) => {
    if (!path) return match[0]!
    const [root, ...rest] = path.split('.')
    const value = root === 'input' ? at(input, rest) : undefined
    return value === undefined ? 'unknown' : typeof value === 'string' ? value : canonical(value)
  })

const exposeOf = (def: BindableCapability['definition']): Expose | undefined =>
  def.confirmation
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
): ActionConfig<StandardSchemaV1, Output, Session, State> => {
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
  const checked =
    runtime &&
    principalOf &&
    (async (args: { input: unknown; state: State; ctx: Ctx<Session> }): Promise<GuardResult> => {
      const listing = args.input === undefined
      const key = def.targetAt && !listing ? at(args.input, tokens(def.targetAt)) : undefined
      // listing a targeted capability, v0 has no input to name the target: the call checks it
      if (listing && def.target) return v0Guards(args)
      const result = await runtime.check({
        principal: await principalOf(args.ctx),
        offer: def.target && typeof key === 'string' ? `${def.id}@${def.target}:${key}` : def.id,
        ...(!listing && { input: args.input }),
        ...(confirmedCalls.has(args.ctx) && { confirmed: { basis: 'v0-client-flag' as const } }),
      })
      if (result.status === 'ok') return v0Guards(args)
      // listing, without input: what the call itself would settle doesn't rule the action out. That's the input,
      // the confirmation, and a condition on the input, which is unknown without one (rule 5 refuses unknown)
      const onInput = declarative.find((c) => c.id === result.condition?.id)
      if (
        listing &&
        (result.code === 'invalid_input' ||
          result.code === 'confirmation_required' ||
          (result.code === 'precondition' &&
            onInput &&
            readsInput((onInput as { expr: unknown }).expr)))
      )
        return v0Guards(args)
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
  const template = def.confirmation?.summary
  return {
    // the capability's id, as the migration form's `id` carries it (RFC 0001 §10.1)
    id: def.id,
    name: config.name,
    description: def.description,
    input: schema,
    state: config.state,
    expose: exposeOf(def),
    requires: conditions.length ? conditions.map((c) => c.description).join('; ') : undefined,
    guard: guard as ActionConfig<StandardSchemaV1, Output, Session, State>['guard'],
    summary: (config.summary ??
      (template && (({ input }: { input: unknown }) => fill(template, input)))) as ActionConfig<
      StandardSchemaV1,
      Output,
      Session,
      State
    >['summary'],
    message: config.message as ActionConfig<StandardSchemaV1, Output, Session, State>['message'],
    effects: config.effects,
    readOnly: def.kind === 'query' || undefined,
    output: config.capability.schemas.output,
    run: config.run as ActionConfig<StandardSchemaV1, Output, Session, State>['run'],
  }
}
