import {
  CapabilityManifest,
  type AuthorizationRequirement,
  type Binding,
  type CapabilityDefinition,
  type CapabilityKind,
  type Claim,
  type Condition,
  type Effect,
  type Expr,
  type Id,
  type JSONPointer,
  type PrincipalDefinition,
  type Provenance,
  type Ref,
  type Relation,
  type ResourceDefinition,
  type Reversibility,
  type Source,
  type URI,
} from '../schema.ts'
import type { ContextPaths } from './paths.ts'
import { toJsonSchema, type Infer, type StandardSchemaV1 } from './standard.ts'
import type { Declared, Guard, When } from './when.ts'

// the source authoring names for what it converts (Standard Schema to JSON Schema): basis `inferred`, by a tool
// (RFC 0001 §12.1, rule 3). defineManifest declares it whenever a definition uses it
export const AUTHORING_SOURCE = 'affordances.ir'
const inferred: Provenance = { source: AUTHORING_SOURCE, basis: 'inferred' }

// what defineResource, definePrincipal and defineCapability return: the IR's definition, plus the schemas it came
// from, which a runtime validates with. The type parameters carry what the types infer from
type Schemas = {
  readonly attributes?: StandardSchemaV1
  readonly input?: StandardSchemaV1
  readonly output?: StandardSchemaV1
}

export type DefinedResource<Attributes = unknown> = {
  readonly definition: ResourceDefinition
  readonly schemas: Schemas
  readonly '~attributes'?: Attributes
}

export type DefinedPrincipal<Attributes = unknown> = {
  readonly definition: PrincipalDefinition
  readonly schemas: Schemas
  readonly '~attributes'?: Attributes
}

export type DefinedCapability<Guards extends string = string, Input = unknown, Output = unknown> = {
  readonly definition: CapabilityDefinition
  readonly schemas: Schemas
  readonly '~guards'?: Guards
  readonly '~input'?: Input
  readonly '~output'?: Output
}

export type GuardsOf<C> = C extends DefinedCapability<infer G> ? G : never
export type InputOf<C> = C extends DefinedCapability<string, infer I> ? I : never
export type OutputOf<C> = C extends DefinedCapability<string, unknown, infer O> ? O : never

type AttributesOf<R> = R extends { readonly '~attributes'?: infer A }
  ? Exclude<A, undefined>
  : never

const fieldProvenance = (fields: string[]) =>
  fields.length
    ? { fieldProvenance: Object.fromEntries(fields.map((f) => [`/${f}`, inferred])) }
    : {}

// drops undefined, so a definition has only the fields that were given (every IR object is strict)
const defined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T

const idOf = (value: { readonly definition: { readonly id: Id } } | Id): Id =>
  typeof value === 'string' ? value : value.definition.id

// ---- resources ----

export const defineResource = <const S extends StandardSchemaV1 | undefined = undefined>(spec: {
  id: Id
  title?: string
  description: string
  // the attribute that identifies an instance; typed against `attributes` when there are any
  key: [Infer<S>] extends [never] ? string : keyof Infer<S> & string
  attributes?: S
  contains?: readonly (DefinedResource | Id)[]
  // instances are mutually exclusive choices, such as plans (RFC 0001 §2.1)
  alternatives?: true
}): DefinedResource<Infer<S>> => ({
  definition: defined({
    id: spec.id,
    title: spec.title,
    description: spec.description,
    key: spec.key,
    attributes: spec.attributes && toJsonSchema(spec.attributes, `${spec.id}'s attributes`),
    contains: spec.contains?.map(idOf),
    alternatives: spec.alternatives,
    ...fieldProvenance(spec.attributes ? ['attributes'] : []),
  }) as ResourceDefinition,
  schemas: defined({ attributes: spec.attributes }),
})

// the attributes conditions can read about the caller (RFC 0001 §2.3); `authenticated` is built in, and isn't a path
export const definePrincipal = <const S extends StandardSchemaV1>(spec: {
  description?: string
  attributes: S
}): DefinedPrincipal<Infer<S>> => ({
  definition: defined({
    description: spec.description,
    attributes: toJsonSchema(spec.attributes, "the principal's attributes"),
    ...fieldProvenance(['attributes']),
  }) as PrincipalDefinition,
  schemas: { attributes: spec.attributes },
})

// ---- capabilities ----

type ReferenceSpec = { readonly resource: DefinedResource; readonly at: string }
type Roots = 'target' | 'input' | 'principal' | 'item'

// a root that holds nothing is left out, rather than typed never: an object with a never property is never, which
// would erase every other root's paths too
type Root<K extends string, V> = [V] extends [never] ? {} : { [k in K]: V }

// what each path root holds, for one capability
type Context<T, I, P, Refs> = Root<'target', AttributesOf<T>> &
  Root<'input', Infer<I>> &
  Root<'principal', AttributesOf<P>> & {
    [K in keyof Refs]: Refs[K] extends ReferenceSpec ? AttributesOf<Refs[K]['resource']> : never
  }

type ConditionSpec<Paths extends string> = Declared<Paths> | Guard

type GuardIds<C> = {
  [K in keyof C & string]: C[K] extends Guard ? K : never
}[keyof C & string]

type EffectSpec<Paths extends string> = {
  readonly description: string
  readonly reversibility?: Reversibility
  readonly compensatedBy?: DefinedCapability | Id
} & (
  | {
      readonly category: 'state'
      readonly change: 'create' | 'update' | 'delete'
      readonly resource: DefinedResource | Id
      // what holds after success
      readonly establishes?: When<Paths>
    }
  | { readonly category: 'external' | 'financial' | 'access' }
)

const conditions = (spec: Record<string, Declared | Guard>): Condition[] =>
  Object.entries(spec).map(([id, c]) =>
    c.kind === 'guard'
      ? { id, description: c.description, guard: true }
      : { id, description: c.description, expr: c.expr },
  )

const effect = (spec: EffectSpec<string>): Effect =>
  defined({
    category: spec.category,
    description: spec.description,
    reversibility: spec.reversibility,
    compensatedBy: spec.compensatedBy && idOf(spec.compensatedBy),
    ...(spec.category === 'state'
      ? {
          change: spec.change,
          resource: idOf(spec.resource),
          establishes: spec.establishes?.expr as Expr | undefined,
        }
      : {}),
  }) as Effect

// an input property name, as the JSON Pointer a Reference stores (RFC 0001 §12.1)
const pointer = (name: string): JSONPointer =>
  `/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`

export const defineCapability = <
  const T extends DefinedResource | undefined = undefined,
  const I extends StandardSchemaV1 | undefined = undefined,
  const O extends StandardSchemaV1 | undefined = undefined,
  const P extends DefinedPrincipal | undefined = undefined,
  const Refs extends { readonly [name: string]: ReferenceSpec } & {
    readonly [K in Roots]?: never
  } = {},
  const Pre extends Record<string, ConditionSpec<ContextPaths<Context<T, I, P, Refs>>>> = {},
  // authorization conditions read only the principal and the target (RFC 0001 §3.2)
  const Auth extends Record<
    string,
    ConditionSpec<
      ContextPaths<Root<'target', AttributesOf<T>> & Root<'principal', AttributesOf<P>>>
    >
  > = {},
>(spec: {
  id: Id
  kind: CapabilityKind
  title?: string
  description: string
  target?: T
  // other resources it takes as input, by the input property that holds each one's key
  references?: Refs & { readonly [K in keyof Refs]: { at: keyof Infer<I> & string } }
  input?: I
  output?: O
  // only needed when a condition reads `principal.*`; the manifest declares the same principal
  principal?: P
  safe?: boolean
  idempotent?: boolean
  preconditions?: Pre
  authorization?: { principal: AuthorizationRequirement['principal']; conditions?: Auth }
  // presence means required; `{path}` placeholders fill in at run time (RFC 0001 §3.2)
  confirmation?: { summary: string }
  // what an effect establishes reads only the target (RFC 0001 §4)
  effects?: readonly EffectSpec<ContextPaths<Root<'target', AttributesOf<T>>>>[]
  deprecated?: { replacedBy?: DefinedCapability | Id; reason?: string }
}): DefinedCapability<GuardIds<Pre> | GuardIds<Auth>, Infer<I>, Infer<O>> => {
  const converted = [spec.input && 'input', spec.output && 'output'].filter((f) => f !== undefined)
  return {
    definition: defined({
      id: spec.id,
      kind: spec.kind,
      title: spec.title,
      description: spec.description,
      target: spec.target?.definition.id,
      references:
        spec.references &&
        Object.entries(spec.references as Record<string, ReferenceSpec>).map(([name, r]) => ({
          name,
          resource: r.resource.definition.id,
          at: pointer(r.at),
        })),
      input: spec.input && toJsonSchema(spec.input, `${spec.id}'s input`),
      output: spec.output && toJsonSchema(spec.output, `${spec.id}'s output`),
      safe: spec.safe,
      idempotent: spec.idempotent,
      preconditions: spec.preconditions && conditions(spec.preconditions),
      authorization:
        spec.authorization &&
        defined({
          principal: spec.authorization.principal,
          conditions: spec.authorization.conditions && conditions(spec.authorization.conditions),
        }),
      confirmation: spec.confirmation && { summary: spec.confirmation.summary },
      effects: spec.effects?.map(effect),
      deprecated:
        spec.deprecated &&
        defined({
          replacedBy: spec.deprecated.replacedBy && idOf(spec.deprecated.replacedBy),
          reason: spec.deprecated.reason,
        }),
      ...fieldProvenance(converted),
    }) as CapabilityDefinition,
    schemas: defined({ input: spec.input, output: spec.output }),
  }
}

// ---- claims ----

// claims keyed by id, as conditions are. Their source is the manifest's owner; `applies` reads `target.*` only
// (RFC 0001 §9)
export type DefinedClaims = { readonly claims: readonly Omit<Claim, 'provenance'>[] }

export const defineClaims = (
  spec: Record<
    string,
    {
      subject: DefinedCapability | DefinedResource | Ref
      about?: JSONPointer
      kind: Claim['kind']
      statement: string
      quantity?: { value: number; unit: string }
      applies?: When<`target.${string}`>
    }
  >,
): DefinedClaims => ({
  claims: Object.entries(spec).map(
    ([id, c]) =>
      defined({
        id,
        subject: typeof c.subject === 'string' ? c.subject : c.subject.definition.id,
        about: c.about,
        kind: c.kind,
        statement: c.statement,
        quantity: c.quantity,
        applies: c.applies?.expr,
      }) as Omit<Claim, 'provenance'>,
  ),
})

// ---- the manifest ----

// one place declares the namespace and the owner; the owner's statements are `declared`, and only the owner's
// (RFC 0001 §12.1, rule 3)
export const defineManifest = (spec: {
  namespace: URI
  title?: string
  owner: { id?: string; name: string; href?: URI }
  principal?: DefinedPrincipal
  resources: readonly DefinedResource[]
  capabilities: readonly DefinedCapability[]
  claims?: readonly DefinedClaims[]
  relations?: readonly Relation[]
  bindings?: readonly Binding[]
}): CapabilityManifest => {
  const owner = spec.owner.id ?? 'owner'
  const definitions = [
    ...(spec.principal ? [spec.principal.definition] : []),
    ...spec.resources.map((r) => r.definition),
    ...spec.capabilities.map((c) => c.definition),
  ]
  const usesTool = definitions.some((d) => d.fieldProvenance !== undefined)
  const sources: Source[] = [
    defined({ id: owner, role: 'owner' as const, name: spec.owner.name, href: spec.owner.href }),
    ...(usesTool
      ? [{ id: AUTHORING_SOURCE, role: 'tool' as const, name: '@affordances/ir authoring' }]
      : []),
  ]
  const claims = spec.claims?.flatMap((c) =>
    c.claims.map((claim): Claim => ({
      ...claim,
      provenance: { source: owner, basis: 'declared' },
    })),
  )
  const manifest = defined({
    schemaVersion: '0.1' as const,
    namespace: spec.namespace,
    title: spec.title,
    provenance: { source: owner, basis: 'declared' as const },
    principal: spec.principal?.definition,
    sources,
    resources: spec.resources.map((r) => r.definition),
    capabilities: spec.capabilities.map((c) => c.definition),
    relations: spec.relations && [...spec.relations],
    claims: claims?.length ? claims : undefined,
    bindings: spec.bindings && [...spec.bindings],
  })
  // the shapes are the IR's; reference resolution, paths and the safety rules are validate's (M2b)
  return CapabilityManifest.parse(manifest)
}
