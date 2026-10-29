import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import type { Expose, NavItem } from '@afford/protocol'
import { AffordError, RedirectSignal } from './errors.ts'

export const AFFORD = Symbol.for('afford.action')
const STATE = Symbol.for('afford.state')

export type Ctx<Session = unknown> = {
  // an action that starts a session (e.g. an anonymous cart) assigns it here, so the state reload sees it
  session: Session | null
  request?: Request
  // 'ui' when a component called the server action, 'agent' when the call came through the handler
  via: 'ui' | 'agent'
}

export type Auth<Session> = (request: Request) => Session | null | Promise<Session | null>

export type Entities = Record<string, unknown>

// true passes; a string is the reason it fails; false fails without one
export type GuardResult = boolean | string

export type ActionConfig<
  Schema extends StandardSchemaV1,
  Output,
  Session,
  State extends Entities,
> = {
  name: string
  description: string
  input: Schema
  // the route's state, so guard and summary are typed against it
  state?: StateDef<State>
  // omitted: not reachable by agents
  expose?: Expose
  // the human-readable precondition shown to agents, e.g. "The variant is in stock"
  requires?: string
  // `input` is undefined when the graph is built, so return true for it unless the action is unavailable regardless
  guard?: (args: {
    input: StandardSchemaV1.InferOutput<Schema> | undefined
    state: State
    ctx: Ctx<Session>
  }) => GuardResult | Promise<GuardResult>
  // what a `confirm` action will do, shown to the person before they approve it
  summary?: (args: {
    input: StandardSchemaV1.InferOutput<Schema>
    state: State
  }) => string | Promise<string>
  // a sentence an agent can repeat to the user after the action ran
  message?: (args: { input: StandardSchemaV1.InferOutput<Schema>; output: Output }) => string
  effects?: (keyof State & string)[]
  readOnly?: boolean
  output?: StandardSchemaV1
  // for schemas that don't implement Standard JSON Schema
  jsonSchema?: Record<string, unknown>
  run: (input: StandardSchemaV1.InferOutput<Schema>, ctx: Ctx<Session>) => Output | Promise<Output>
}

export type ActionMeta = Omit<
  ActionConfig<StandardSchemaV1, unknown, unknown, Entities>,
  'jsonSchema'
> & {
  jsonSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  auth?: Auth<unknown>
}

// the server action: called with input, or with FormData (a <form action>), or with (prevState, FormData) (useActionState)
export type Action<Input = unknown, Output = unknown> = ((
  ...args: [input: Input] | [prev: unknown, form: FormData] | [form: FormData]
) => Promise<Output>) & { [AFFORD]: ActionMeta }

// what a manifest holds: any action or state, whatever its input or entity types
// oxlint-disable-next-line typescript/no-explicit-any
export type AnyAction = Action<any, any>
// oxlint-disable-next-line typescript/no-explicit-any
export type AnyState = StateDef<any>

export type StateLoader<State extends Entities, Session> = (args: {
  params: Record<string, string | string[]>
  searchParams: URLSearchParams
  ctx: Ctx<Session>
}) => State | Promise<State>

export type StateDef<State extends Entities = Entities> = {
  [STATE]: true
  load: StateLoader<State, unknown>
  nav?: (state: State) => NavItem[]
}

export type InferState<S> = S extends StateDef<infer State> ? State : Entities

export const isAction = (value: unknown): value is AnyAction =>
  typeof value === 'function' && AFFORD in value

export const isState = (value: unknown): value is AnyState =>
  typeof value === 'object' && value !== null && STATE in value

const toJsonSchema = (schema: StandardSchemaV1, override?: Record<string, unknown>) => {
  if (override) return override
  const converter = (schema['~standard'] as Partial<StandardJSONSchemaV1.Props>).jsonSchema
  if (!converter)
    throw new TypeError(
      `This schema (${schema['~standard'].vendor}) can't produce JSON Schema; pass \`jsonSchema\` to defineAction`,
    )
  return converter.input({ target: 'draft-2020-12' })
}

export const validate = async <Schema extends StandardSchemaV1>(schema: Schema, value: unknown) => {
  const result = await schema['~standard'].validate(value)
  if (!result.issues) return result.value as StandardSchemaV1.InferOutput<Schema>
  throw new AffordError('invalid_input', "Input does not match the action's schema", {
    issues: result.issues.map((issue) => ({
      path: issue.path?.map((key) => (typeof key === 'object' ? key.key : key)),
      message: issue.message,
    })),
  })
}

const fromForm = (form: FormData) => {
  const out: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {}
  for (const key of new Set(form.keys())) {
    // next adds $ACTION_* fields to progressively enhanced forms
    if (key.startsWith('$ACTION')) continue
    const all = form.getAll(key)
    out[key] = all.length > 1 ? all : all[0]!
  }
  return out
}

const inputOf = (args: unknown[]) => {
  const form = args.find((arg) => arg instanceof FormData)
  return form ? fromForm(form) : args[0]
}

export type AffordOptions<Session> = {
  // resolves the caller's session from a request; shared by the UI path and the agent handler
  auth?: Auth<Session>
  // the current request on the UI path, for frameworks where it's ambient (e.g. next's headers())
  request?: () => Request | Promise<Request>
  // turns redirect() into the framework's own redirect on the UI path
  redirect?: (to: string) => never
}

export const createAfford = <Session = never>(options: AffordOptions<Session> = {}) => {
  const defineAction = <Schema extends StandardSchemaV1, Output, State extends Entities = Entities>(
    config: ActionConfig<Schema, Output, Session, State>,
  ): Action<StandardSchemaV1.InferInput<Schema>, Output> => {
    if (!config.expose && process.env.NODE_ENV !== 'production')
      console.warn(`[afford] ${config.name} has no \`expose\`, so agents can't reach it`)

    const action = async (...args: unknown[]) => {
      const input = await validate(config.input, inputOf(args))
      const request = await options.request?.()
      const session = request && options.auth ? await options.auth(request) : null
      try {
        return await config.run(input, { session, request, via: 'ui' })
      } catch (error) {
        if (error instanceof RedirectSignal && options.redirect) options.redirect(error.to)
        throw error
      }
    }
    const { jsonSchema, state: _state, ...rest } = config
    const meta: ActionMeta = {
      ...(rest as unknown as ActionMeta),
      jsonSchema: toJsonSchema(config.input, jsonSchema),
      outputSchema: config.output && toJsonSchema(config.output),
      auth: options.auth as Auth<unknown> | undefined,
    }
    return Object.assign(action, { [AFFORD]: meta }) as unknown as Action<
      StandardSchemaV1.InferInput<Schema>,
      Output
    >
  }

  const defineState = <State extends Entities>(
    load: StateLoader<State, Session>,
    extra: { nav?: (state: State) => NavItem[] } = {},
  ): StateDef<State> => ({ [STATE]: true, load: load as StateLoader<State, unknown>, ...extra })

  return { defineAction, defineState }
}

export const { defineAction, defineState } = createAfford()
