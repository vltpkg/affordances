import type { Basis, CapabilityDefinition, CapabilityManifest, Id } from '@affordances/ir'

// RFC 0002's types (§2-§8), as the RFC states them

export type Revision = string // 'sha256-…', a projection revision
export type OfferRevision = string // 'sha256-…', an offer revision
export type OfferId = string
export type ChoiceSetId = string
export type PolicyId = string
export type RelevanceMethodId = string

// §2: what the agent says, none of it trusted, none of it able to change availability
export type ProjectionRequest = {
  principal: Principal // resolved by the application, never sent by the agent
  start?: ResourceRef | Id // a resource instance, or a capability or resource type to start from
  task?: Task
  seen?: Revision
  policy?: PolicyId
  budget?: Budget
  // instances that bind references wherever their type matches, after the start's own: never a wider scope, never
  // an offer, and one the principal can't load binds nothing (§2)
  bind?: ResourceRef[]
}
export type ResourceRef = { type: Id; key: string }
export type Task = { statement: string }
// facts: a limit in comparison cells (§6.6), and only a request's own: a policy's default budget never cuts the table
export type Budget = { offers?: number; depth?: number; facts?: number }

// §3
export type Principal = {
  authenticated: boolean
  subject?: string // for approval tokens only: never echoed, never in a revision
  attributes: Record<string, unknown>
}

// §2.1: how the runtime learns what the application knows
/**
 * A resolver MUST return null for a resource its principal can't read. The runtime evaluates conditions on whatever a
 * resolver returns, so a resolver that ignores the principal leaks condition values (e.g. through a start naming
 * another user's resource). resolverConformance checks it (RFC 0002 §2.1).
 */
export type ResourceResolver = {
  load(
    key: string,
    principal: Principal,
  ): Promise<{ attributes: Record<string, unknown>; version?: string } | null>
  list?(principal: Principal, scope: { capability: Id }): Promise<string[]>
}

// §11: what the application registers for a capability: its run, and its guards
export type Handler = {
  // runs the capability once every check has passed (§8.1, step 9); a query returns its output
  run?(
    input: unknown,
    ctx: {
      principal: Principal
      target?: ResourceRef
      refs: Record<string, { key: string; attributes: Record<string, unknown> } | undefined>
    },
  ): unknown
  guards?: Record<string, GuardImpl>
  // a sentence to repeat to the user, as v0's message
  message?(args: { input: unknown; output: unknown }): string
}
// a guard: true is "not ruled out", false or a string rules it out (the string says why). input is undefined at
// projection time, and an execution-only guard isn't run then at all (§4.2)
export type GuardImpl = ((args: {
  input: Record<string, unknown> | undefined
  target?: { key: string; attributes: Record<string, unknown> }
  refs: Record<string, { key: string; attributes: Record<string, unknown> } | undefined>
  principal: Principal
}) => boolean | string | Promise<boolean | string>) & { executionOnly?: true }

// §4.1
export type CapabilityOffer = {
  id: OfferId
  capability: Id
  target?: ResourceRef
  with?: Record<string, string>
  revision: OfferRevision
  availability: Availability
  conditions: ConditionResult[]
  requirements: Requirements
  consequential: boolean
  claims: ClaimView[]
  relevance: Relevance
  alternatives: { count: number }
  choiceSet?: ChoiceSetId
}

// §4.2
export type Availability =
  | { status: 'available' }
  | { status: 'needs-input'; inputs: string[] }
  | { status: 'needs-authorization' }
  | { status: 'unavailable'; because: string[] }
  | { status: 'unknown'; because: string[] }
export type ConditionResult = {
  id: string
  description: string
  value: true | false | 'unknown'
  detail?: string
}

// §4.3
export type Requirements = {
  authorization: 'met' | 'unmet' | 'unknown' | 'none-declared'
  confirmation?: { summary: string }
}

// §4.4
export type Relevance =
  | { level: 'undetermined' }
  | { level: 'direct' | 'related' | 'unrelated'; basis: RelevanceBasis[] }
export type RelevanceBasis =
  | { kind: 'start'; detail: string }
  | { kind: 'relation'; relation: string; from: Id }
  | { kind: 'task-text'; matched: string[] }

// §4.5
export type ClaimView = {
  id: string
  kind: 'recommendation' | 'benefit' | 'estimate' | 'assessment'
  statement: string
  quantity?: { value: number; unit: string }
  source: { id: string; name: string; role: 'owner' | 'tool' | 'third-party' }
  basis: Basis
  cites?: string[] // the target attributes its statement relies on (RFC 0001 §9), in every comparison it's shown with
}

// §5
export type ChoiceSet = {
  id: ChoiceSetId
  capability: Id
  over: Id
  members: OfferId[]
  order: OrderBasis
}

// §6.6, rule 6: what tells a choice set's members apart, every declared attribute of each, as its resolver returned it
export type Comparison = {
  differ: string[] // the declared attributes on which the members differ, in the runtime's column order
  rows: Record<string, unknown>[] // one per member, in `members` order: each attribute in `differ` it supplied
  shared: Record<string, unknown> // attributes every member supplied with an equal value: stated once
  unsupplied: { member: OfferId; attributes: string[] }[] // declared attributes a member's resolver left out
  omitted: { attributes: string[] } // columns cut by the request's own facts budget, named
}
// a choice set as a view carries it: never without its comparison (§6.6)
export type ViewChoiceSet = ChoiceSet & { comparison: Comparison }

// §6
export type DiscoveryPolicy = {
  id: PolicyId
  description: string
  scope: 'exhaustive' | 'start' | 'neighborhood'
  depth?: number
  order: OrderMethod
  relevance?: RelevanceMethodId
  claims: 'shown' | 'omitted'
  budget?: Budget
}
export type OrderMethod = 'canonical' | 'relevance' | { byClaim: 'recommendation' }
export type View = {
  revision: Revision
  policy: PolicyId
  stale?: true
  offers: CapabilityOffer[]
  choiceSets: ViewChoiceSet[]
  order: OrderBasis
  omitted: Omitted
}
export type Omitted = {
  offers: number
  choiceSets: number
  claims: number
  expand: Expansion[]
}
// a basis that names no claim, recommendation or source: what a structural rendering may state (§6.4)
export type ClaimFreeOrderBasis =
  | { by: 'canonical' }
  | { by: 'relevance'; method: RelevanceMethodId }
  // groups by a manifest-derived attribute, in an order the variant fixes, each group in its within order (intake,
  // 2026-11-18, for RFC 0003's S). The key is a closed set, never free text, so it can't carry framing
  | { by: 'group'; key: GroupKey; within: ClaimFreeOrderBasis }
// targetType: the offer's target's resource type; untargeted offers first, then the manifest's resource order
export type GroupKey = 'targetType'
export type OrderBasis =
  | ClaimFreeOrderBasis
  | { by: 'claim'; kind: 'recommendation'; source: string }
export type Expansion = {
  from: OfferId | ChoiceSetId | ResourceRef
  along: 'alternatives' | 'members' | 'relations' | 'contains' | 'enables' | 'more' | 'comparison'
  count: number
  // a choice set summarized to its member count keeps its comparison, whole but for the request's facts (§6.6)
  comparison?: Comparison
}

// §11
export type Projection = {
  revision: Revision
  // every offer the principal may see, in canonical order: what views and expansions draw from (M3c)
  offers: CapabilityOffer[]
  choiceSets: ChoiceSet[]
  view(): View // the first view, under the request's policy and budget
  expand(expansion: Pick<Expansion, 'from' | 'along'>, options?: { budget?: Budget }): Promise<View>
  inspect(offer: OfferId): Promise<OfferDetails>
  // throws: a projection is runtime-internal, and only views are wire-visible (§11)
  toJSON(): never
}

export type OfferDetails = {
  offer: CapabilityOffer
  definition: CapabilityDefinition
  derived: {
    relation: 'enables' | 'prerequisite'
    to: Id
    basis: Extract<Basis, 'inferred'>
    from: string // the pointers into the manifest it was derived from
  }[]
}

export type Runtime = {
  manifest: CapabilityManifest
  project(request: ProjectionRequest): Promise<Projection>
  check(request: CheckRequest): Promise<CheckResult>
  execute(request: ExecutionRequest): Promise<ExecutionResult>
}

// §8: execution
export type ApprovalToken = string
export type InputIssue = { at: string; message: string }
// records a token's nonce until expiresAt; false when it was already recorded (§8.2)
export type TokenStore = { claim(nonce: string, expiresAt: Date): Promise<boolean> }

export type ExecutionRequest = {
  principal: Principal // resolved afresh by the binding for this request
  offer: OfferId // or a capability id, with the target's key in the input at targetAt
  input?: unknown
  approval?: ApprovalToken
  ifRevision?: OfferRevision
  // the caller's projection request, whole: changes are of the view it shows (§8.3). Its start is the target's when
  // it names none (simplify C2)
  view?: Omit<ProjectionRequest, 'principal'>
}
export type RefusalCode =
  | 'not_found'
  | 'unauthorized'
  | 'rate_limited'
  | 'invalid_input'
  | 'precondition'
  | 'stale'
  | 'confirmation_required'
export type Refusal = {
  status: 'refused'
  code: RefusalCode
  condition?: { id: string; description: string }
  detail?: string
  detailTruncated?: true
  issues?: InputIssue[]
  confirmation?: { summary: string; approval?: ApprovalToken; expiresAt?: string }
  // for rate_limited: when to try again, which a host sends as Retry-After (RFC 0004 §2.3)
  retryAfterSeconds?: number
  revision: OfferRevision
}
// §8.4: what the runtime saw change, through the resolvers, before and after the run
export type ObservedChange = {
  resource: ResourceRef
  change: 'create' | 'update' | 'delete'
  attributes?: string[] // which declared attributes changed, for an update
  matches?: number // the index, in canonical order, of the declared state effect it accounts for
  contradicts?: true // the effect it matches declares what it establishes, and that's false after the run
}
// §8.3: the offers whose existence or availability changed, against the projection before the execution
export type OfferChanges = {
  added: CapabilityOffer[]
  removed: OfferId[]
  changed: { id: OfferId; availability: Availability }[]
}
type Observed = {
  observed: ObservedChange[]
  undeclared: ObservedChange[]
  revision: Revision // the new projection revision
  changes: OfferChanges
}
export type ExecutionResult =
  | ({ status: 'succeeded'; output?: unknown; message?: string } & Observed)
  | Refusal
  // the handler threw, or returned off its output schema, after the checks passed: what changed anyway is reported
  | ({ status: 'failed'; message: string } & Observed)

// §8.1 steps 1-7 without running, for a binding that runs its own handler, as v0's agent path does (M3d, C3.1).
// It never makes, reads or takes an approval token: v0's confirm is v0's own, recorded with its basis
export type CheckRequest = Omit<ExecutionRequest, 'approval' | 'view'> & {
  confirmed?: { basis: 'v0-client-flag' }
}
export type CheckResult =
  | { status: 'ok'; revision: OfferRevision; confirmation?: { basis: 'v0-client-flag' } }
  | (Omit<Refusal, 'confirmation'> & { confirmation?: { summary: string } })
