import { expect, test } from 'vitest'
import type * as IR from '../src/index.ts'

// RFC 0001 §13's types (as amended in §2.3, §3.1 and §6.4), written out as the RFC states them. The package's types are
// inferred from its zod source; this checks the two say the same thing, in both directions, at type-check time
namespace Spec {
  export type Id = string
  export type Ref = string
  export type URI = string
  export type JSONPointer = string
  export type JSONSchema = Record<string, unknown>
  export type Extensions = Record<URI, unknown>
  export type CapabilityManifest = {
    schemaVersion: '0.1'
    namespace: URI
    title?: string
    provenance: Provenance
    principal?: PrincipalDefinition
    sources: Source[]
    resources: ResourceDefinition[]
    capabilities: CapabilityDefinition[]
    relations?: Relation[]
    claims?: Claim[]
    bindings?: Binding[]
    extensions?: Extensions
  }
  export type PrincipalDefinition = Attributed & { description?: string; attributes: JSONSchema }
  export type Source = {
    id: string
    role: 'owner' | 'tool' | 'third-party'
    name: string
    href?: URI
  }
  export type Basis = 'declared' | 'inferred' | 'imported' | 'observed' | 'verified'
  export type Provenance = { source: string; basis: Basis; evidence?: Evidence[] }
  export type Evidence = { description: string; href?: URI; digest?: string }
  type Attributed = {
    provenance?: Provenance
    fieldProvenance?: Record<JSONPointer, Provenance>
    extensions?: Extensions
  }
  export type ResourceDefinition = Attributed & {
    id: Id
    title?: string
    description: string
    key: string
    attributes?: JSONSchema
    contains?: Id[]
    alternatives?: true
  }
  export type CapabilityKind = 'query' | 'action' | 'event'
  export type CapabilityDefinition = Attributed & {
    id: Id
    kind: CapabilityKind
    title?: string
    description: string
    target?: Id
    targetAt?: JSONPointer
    references?: Reference[]
    input?: JSONSchema
    output?: JSONSchema
    safe?: boolean
    idempotent?: boolean
    preconditions?: Condition[]
    authorization?: AuthorizationRequirement
    confirmation?: ConfirmationRequirement
    effects?: Effect[]
    deprecated?: { replacedBy?: Id; reason?: string }
  }
  export type Reference = { name: string; resource: Id; at: JSONPointer }
  export type Condition = { id: string; description: string } & (
    | { expr: Expr; guard?: never }
    | { guard: true; expr?: never }
  )
  export type Scalar = string | number | boolean | null
  export type Path = string
  export type Operand = { path: Path } | { value: Scalar | Scalar[] } | { count: Path }
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
  export type AuthorizationRequirement = {
    principal: 'any' | 'authenticated'
    conditions?: Condition[]
  }
  export type ConfirmationRequirement = { summary: string }
  export type Reversibility = 'reversible' | 'compensable' | 'irreversible'
  type EffectBase = { description: string; reversibility?: Reversibility; compensatedBy?: Id }
  export type StateEffect = EffectBase & {
    category: 'state'
    change: 'create' | 'update' | 'delete'
    resource: Id
    establishes?: Expr
  }
  export type OtherEffect = EffectBase & { category: 'external' | 'financial' | 'access' }
  export type Effect = StateEffect | OtherEffect
  export type Relation = {
    type: 'alternativeTo' | 'enables' | 'relatedTo'
    from: Ref
    to: Ref
    description?: string
    provenance?: Provenance
    extensions?: Extensions
  }
  export type Claim = {
    id: string
    subject: Ref
    about?: JSONPointer
    kind: 'recommendation' | 'benefit' | 'estimate' | 'assessment'
    statement: string
    quantity?: { value: number; unit: string }
    applies?: Expr
    provenance: Provenance
    extensions?: Extensions
  }
  export type Binding = {
    capability: Id
    protocol: string
    address: Record<string, string>
    extensions?: Extensions
  }
}

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const same = <T extends true>() => true as T

test('the inferred types are RFC 0001 §13', () => {
  expect([
    same<Same<IR.CapabilityManifest, Spec.CapabilityManifest>>(),
    same<Same<IR.PrincipalDefinition, Spec.PrincipalDefinition>>(),
    same<Same<IR.Source, Spec.Source>>(),
    same<Same<IR.Provenance, Spec.Provenance>>(),
    same<Same<IR.Evidence, Spec.Evidence>>(),
    same<Same<IR.ResourceDefinition, Spec.ResourceDefinition>>(),
    same<Same<IR.CapabilityDefinition, Spec.CapabilityDefinition>>(),
    same<Same<IR.CapabilityKind, Spec.CapabilityKind>>(),
    same<Same<IR.Reference, Spec.Reference>>(),
    same<Same<IR.Condition, Spec.Condition>>(),
    same<Same<IR.Operand, Spec.Operand>>(),
    same<Same<IR.Expr, Spec.Expr>>(),
    same<Same<IR.AuthorizationRequirement, Spec.AuthorizationRequirement>>(),
    same<Same<IR.ConfirmationRequirement, Spec.ConfirmationRequirement>>(),
    same<Same<IR.StateEffect, Spec.StateEffect>>(),
    same<Same<IR.OtherEffect, Spec.OtherEffect>>(),
    same<Same<IR.Effect, Spec.Effect>>(),
    same<Same<IR.Relation, Spec.Relation>>(),
    same<Same<IR.Claim, Spec.Claim>>(),
    same<Same<IR.Binding, Spec.Binding>>(),
  ]).not.toContain(false)
})
