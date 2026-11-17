import { z } from 'zod'

// the IR's one source (RFC 0001 §13, §14): the types are inferred from these, and schema.json is generated from them.
// rules the IR states across fields (a query's effects, evidence for a verified basis) are refinements here and
// conditional subschemas in schema.json (json-schema.ts), so zod and the JSON Schema accept the same documents.
// a refinement's issue carries the IR's error code in `params.code`, for validate

export const SCHEMA_VERSION = '0.1'
export const SCHEMA_ID = 'https://affordances.sh/schemas/ir/0.1/manifest.json'

const ID = '[a-z][A-Za-z0-9]*(?:\\.[a-z][A-Za-z0-9]*)*'
// an absolute URI with no fragment (RFC 3986 absolute-URI); validate checks the full syntax
const ABSOLUTE_URI = '[A-Za-z][A-Za-z0-9+.-]*:[^#\\s]*'

export const Id = z
  .string()
  .regex(new RegExp(`^${ID}$`))
  .max(128)
  .meta({ id: 'Id', description: "A definition's identifier: 'commerce.cart.addItem'" })
export const Ref = z
  .string()
  .regex(new RegExp(`^(?:${ID}|${ABSOLUTE_URI}#${ID})$`))
  .meta({
    id: 'Ref',
    description: 'A local Id, or <namespace URI>#<Id> for a definition in another manifest',
  })
export const URI = z
  .string()
  .regex(new RegExp(`^${ABSOLUTE_URI}$`))
  .meta({ id: 'URI' })
export const JSONPointer = z
  .string()
  .regex(/^(?:\/(?:[^~/]|~[01])*)*$/)
  .meta({ id: 'JSONPointer', description: 'RFC 6901' })
export const JSONSchema = z
  .record(z.string(), z.unknown())
  .meta({ id: 'JSONSchema', description: 'A JSON Schema 2020-12 object, without $schema' })
export const Extensions = z
  .record(z.string().regex(new RegExp(`^${ABSOLUTE_URI}$`)), z.unknown())
  .meta({
    id: 'Extensions',
    description: 'Keys are absolute URIs, each owned by the vocabulary it names',
  })

// provenance (RFC 0001 §8.1)
export const Basis = z.enum(['declared', 'inferred', 'imported', 'observed', 'verified'])
export const Evidence = z
  .strictObject({ description: z.string(), href: URI.optional(), digest: z.string().optional() })
  .meta({ id: 'Evidence' })
// these bases are only as good as what backs them, so they need evidence (rule 3)
export const EVIDENCED: readonly z.infer<typeof Basis>[] = ['imported', 'observed', 'verified']
export const Provenance = z
  .strictObject({ source: z.string(), basis: Basis, evidence: z.array(Evidence).optional() })
  .superRefine((p, ctx) => {
    if (EVIDENCED.includes(p.basis) && !p.evidence?.length)
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: `basis ${p.basis} needs evidence`,
        params: { code: 'E_BASIS' },
      })
  })
  .meta({ id: 'Provenance' })
export const Source = z
  .strictObject({
    id: z.string(),
    role: z.enum(['owner', 'tool', 'third-party']),
    name: z.string(),
    href: URI.optional(),
  })
  .meta({ id: 'Source' })

const attributed = {
  provenance: Provenance.optional(),
  fieldProvenance: z.record(JSONPointer, Provenance).optional(),
  extensions: Extensions.optional(),
}

// conditions (RFC 0001 §3.1)
export const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
export const Path = z
  .string()
  .regex(/^(?:item|(?:target|input|principal|item|[a-z][A-Za-z0-9]*)(?:\.[A-Za-z0-9_]+)+)$/)
  .meta({
    id: 'Path',
    description: "A root, then attribute names: 'target.count', 'item.sku'; or bare 'item'",
  })
export const Operand = z
  .union([
    z.strictObject({ path: Path }),
    z.strictObject({ value: z.union([Scalar, z.array(Scalar)]) }),
    z.strictObject({ count: Path }),
  ])
  .meta({ id: 'Operand' })
export type Scalar = z.infer<typeof Scalar>
export type Path = z.infer<typeof Path>
export type Operand = z.infer<typeof Operand>

// recursive, so the type is written out and the schema is checked against it
export type Expr =
  | { all: Expr[] }
  | { any: Expr[] }
  | { not: Expr }
  | { eq: [Operand, Operand] }
  | { ne: [Operand, Operand] }
  | { lt: [Operand, Operand] }
  | { le: [Operand, Operand] }
  | { gt: [Operand, Operand] }
  | { ge: [Operand, Operand] }
  | { in: [Operand, Operand] }
  | { exists: Path }
  | { some: { of: Path; where: Expr } }
  | { every: { of: Path; where: Expr } }

export const COMPARISONS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in'] as const
const pair = () => z.tuple([Operand, Operand])
const quantifier = () =>
  z.strictObject({
    of: Path,
    get where() {
      return Expr
    },
  })
export const Expr: z.ZodType<Expr> = z
  .lazy(() =>
    z.union([
      z.strictObject({ all: z.array(Expr).min(1) }),
      z.strictObject({ any: z.array(Expr).min(1) }),
      z.strictObject({ not: Expr }),
      ...COMPARISONS.map((op) => z.strictObject({ [op]: pair() })),
      z.strictObject({ exists: Path }),
      z.strictObject({ some: quantifier() }),
      z.strictObject({ every: quantifier() }),
    ]),
  )
  .meta({ id: 'Expr' }) as z.ZodType<Expr>

export const Condition = z
  .union([
    z.strictObject({ id: z.string(), description: z.string(), expr: Expr }),
    z.strictObject({ id: z.string(), description: z.string(), guard: z.literal(true) }),
  ])
  .meta({ id: 'Condition' })

// requirements (RFC 0001 §3.2)
export const AuthorizationRequirement = z
  .strictObject({
    principal: z.enum(['any', 'authenticated']),
    conditions: z.array(Condition).optional(),
  })
  .meta({ id: 'AuthorizationRequirement' })
// presence means required: there's no value for "not required" (rule 2)
export const ConfirmationRequirement = z
  .strictObject({ summary: z.string() })
  .meta({ id: 'ConfirmationRequirement' })

// effects (RFC 0001 §4)
export const Reversibility = z.enum(['reversible', 'compensable', 'irreversible'])
const effectBase = {
  description: z.string(),
  reversibility: Reversibility.optional(),
  compensatedBy: Id.optional(),
}
export const StateEffect = z
  .strictObject({
    ...effectBase,
    category: z.literal('state'),
    change: z.enum(['create', 'update', 'delete']),
    resource: Id,
    establishes: Expr.optional(),
  })
  .meta({ id: 'StateEffect' })
export const OtherEffect = z
  .strictObject({ ...effectBase, category: z.enum(['external', 'financial', 'access']) })
  .meta({ id: 'OtherEffect' })
export const Effect = z
  .union([StateEffect, OtherEffect])
  .superRefine((e, ctx) => {
    if (e.reversibility === 'compensable' && !e.compensatedBy)
      ctx.addIssue({
        code: 'custom',
        path: ['compensatedBy'],
        message: 'a compensable effect names the capability that undoes it',
        params: { code: 'E_SCHEMA' },
      })
  })
  .meta({ id: 'Effect' })

// definitions (RFC 0001 §2)
// a reference's name is a path root, so it can't be one of the built-in roots (RFC 0001 §3.1)
export const ROOTS = ['target', 'input', 'principal', 'item'] as const
export const Reference = z
  .strictObject({
    name: z
      .string()
      .regex(/^[a-z][A-Za-z0-9]*$/)
      .refine((n) => !(ROOTS as readonly string[]).includes(n), {
        message: 'a reference is never named after a root',
        params: { code: 'E_PATH' },
      }),
    resource: Id,
    at: JSONPointer,
  })
  .meta({ id: 'Reference' })

export const ResourceDefinition = z
  .strictObject({
    id: Id,
    title: z.string().optional(),
    description: z.string(),
    key: z.string(),
    attributes: JSONSchema.optional(),
    contains: z.array(Id).optional(),
    alternatives: z.literal(true).optional(),
    ...attributed,
  })
  .meta({ id: 'ResourceDefinition' })

export const CapabilityKind = z.enum(['query', 'action', 'event'])
export const CapabilityDefinition = z
  .strictObject({
    id: Id,
    kind: CapabilityKind,
    title: z.string().optional(),
    description: z.string(),
    target: Id.optional(),
    references: z.array(Reference).optional(),
    input: JSONSchema.optional(),
    output: JSONSchema.optional(),
    safe: z.boolean().optional(),
    idempotent: z.boolean().optional(),
    preconditions: z.array(Condition).optional(),
    authorization: AuthorizationRequirement.optional(),
    confirmation: ConfirmationRequirement.optional(),
    effects: z.array(Effect).optional(),
    deprecated: z
      .strictObject({ replacedBy: Id.optional(), reason: z.string().optional() })
      .optional(),
    ...attributed,
  })
  .superRefine((c, ctx) => {
    const kind = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message, params: { code: 'E_KIND' } })
    if (c.kind === 'query') {
      if (c.safe === false) kind('safe', 'a query is safe')
      if (c.effects?.length) kind('effects', 'a query has no effects')
    }
    if (c.kind === 'action' && c.safe === true) kind('safe', 'a safe action is a query')
    if (c.kind === 'event')
      for (const field of ['input', 'preconditions', 'confirmation', 'effects'] as const)
        if (c[field] !== undefined) kind(field, `an event has no ${field}`)
  })
  .meta({ id: 'CapabilityDefinition' })

export const PrincipalDefinition = z
  .strictObject({ description: z.string().optional(), attributes: JSONSchema, ...attributed })
  .meta({ id: 'PrincipalDefinition' })

// relations, claims, bindings (RFC 0001 §5, §9, §6.3)
export const Relation = z
  .strictObject({
    type: z.enum(['alternativeTo', 'enables', 'relatedTo']),
    from: Ref,
    to: Ref,
    description: z.string().optional(),
    provenance: Provenance.optional(),
    extensions: Extensions.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.type === 'relatedTo' && r.description === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'relatedTo says what the association is',
        params: { code: 'E_SCHEMA' },
      })
  })
  .meta({ id: 'Relation' })

export const Claim = z
  .strictObject({
    id: z.string(),
    subject: Ref,
    about: JSONPointer.optional(),
    kind: z.enum(['recommendation', 'benefit', 'estimate', 'assessment']),
    statement: z.string(),
    quantity: z.strictObject({ value: z.number(), unit: z.string() }).optional(),
    applies: Expr.optional(),
    provenance: Provenance,
    extensions: Extensions.optional(),
  })
  .meta({ id: 'Claim' })

export const Binding = z
  .strictObject({
    capability: Id,
    protocol: z.string(),
    address: z.record(z.string(), z.string()).refine((a) => Object.keys(a).length > 0, {
      message: 'a binding has an address',
    }),
    extensions: Extensions.optional(),
  })
  .meta({ id: 'Binding' })

export const CapabilityManifest = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    namespace: URI,
    title: z.string().optional(),
    provenance: Provenance,
    principal: PrincipalDefinition.optional(),
    sources: z.array(Source),
    resources: z.array(ResourceDefinition),
    capabilities: z.array(CapabilityDefinition),
    relations: z.array(Relation).optional(),
    claims: z.array(Claim).optional(),
    bindings: z.array(Binding).optional(),
    extensions: Extensions.optional(),
  })
  .meta({ id: 'CapabilityManifest' })

export type Id = z.infer<typeof Id>
export type Ref = z.infer<typeof Ref>
export type URI = z.infer<typeof URI>
export type JSONPointer = z.infer<typeof JSONPointer>
export type JSONSchema = z.infer<typeof JSONSchema>
export type Extensions = z.infer<typeof Extensions>
export type Basis = z.infer<typeof Basis>
export type Evidence = z.infer<typeof Evidence>
export type Provenance = z.infer<typeof Provenance>
export type Source = z.infer<typeof Source>
export type Condition = z.infer<typeof Condition>
export type AuthorizationRequirement = z.infer<typeof AuthorizationRequirement>
export type ConfirmationRequirement = z.infer<typeof ConfirmationRequirement>
export type Reversibility = z.infer<typeof Reversibility>
export type StateEffect = z.infer<typeof StateEffect>
export type OtherEffect = z.infer<typeof OtherEffect>
export type Effect = z.infer<typeof Effect>
export type Reference = z.infer<typeof Reference>
export type ResourceDefinition = z.infer<typeof ResourceDefinition>
export type CapabilityKind = z.infer<typeof CapabilityKind>
export type CapabilityDefinition = z.infer<typeof CapabilityDefinition>
// per-kind names for code that needs them (terminology §2.3)
export type QueryCapability = CapabilityDefinition & { kind: 'query' }
export type ActionCapability = CapabilityDefinition & { kind: 'action' }
export type EventCapability = CapabilityDefinition & { kind: 'event' }
export type PrincipalDefinition = z.infer<typeof PrincipalDefinition>
export type Relation = z.infer<typeof Relation>
export type Claim = z.infer<typeof Claim>
export type Binding = z.infer<typeof Binding>
export type CapabilityManifest = z.infer<typeof CapabilityManifest>

// what validate reports (RFC 0001 §7.3); validate itself is M2b
export type ValidationIssue = {
  code: `E_${string}` | `W_${string}`
  message: string
  at: JSONPointer
}
