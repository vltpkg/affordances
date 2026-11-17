import * as fc from 'fast-check'
import { validate, type CapabilityManifest, type Expr } from '@affordances/ir'
import { builtInPolicies } from '../../src/index.ts'
import { testRuntime } from './runtime.ts'
import type {
  DiscoveryPolicy,
  GuardImpl,
  Handler,
  Principal,
  ProjectionRequest,
  ResourceResolver,
} from '../../src/index.ts'

// generated cases for the property tests: manifests that pass validate, states, principals, policies and requests,
// adversarial ones included (a start that doesn't exist, resolvers that throw, budget 1). fast-check shrinks them

export const NS = 'https://gen.example/capabilities'
export const TYPES = ['a.one', 'a.two', 'a.three']
export const WORDS = [
  'plan',
  'cart',
  'deploy',
  'cheap',
  'fast',
  'item',
  'order',
  'trial',
  'list',
  'buy',
]

// a condition over what the generated definitions declare: the target's n, the principal's level, the input's x
const exprArb = (targeted: boolean, input: boolean): fc.Arbitrary<Expr> => {
  const leaves: fc.Arbitrary<Expr>[] = [
    fc
      .integer({ min: 0, max: 3 })
      .map((v): Expr => ({ ge: [{ path: 'principal.level' }, { value: v }] })),
  ]
  if (targeted)
    leaves.push(
      fc
        .integer({ min: 0, max: 3 })
        .map((v): Expr => ({ lt: [{ path: 'target.n' }, { value: v }] })),
      fc.constant<Expr>({ exists: 'target.s' }),
    )
  if (input)
    leaves.push(
      fc
        .integer({ min: 0, max: 3 })
        .map((v): Expr => ({ eq: [{ path: 'input.x' }, { value: v }] })),
    )
  const leaf = fc.oneof(...leaves)
  return fc.oneof(
    { weight: 3, arbitrary: leaf },
    fc.array(leaf, { minLength: 1, maxLength: 2 }).map((all): Expr => ({ all })),
    leaf.map((not): Expr => ({ not })),
  )
}

export type Spec = { manifest: CapabilityManifest; guards: { capability: string; id: string }[] }

const capabilityArb = (i: number) =>
  fc
    .record({
      kind: fc.constantFrom('query' as const, 'action' as const),
      target: fc.option(fc.constantFrom(...TYPES), { nil: undefined }),
      reference: fc.option(fc.constantFrom(...TYPES), { nil: undefined }),
      input: fc.boolean(),
      words: fc.subarray(WORDS, { minLength: 1, maxLength: 3 }),
      preconditions: fc.integer({ min: 0, max: 2 }),
      guard: fc.boolean(),
      authorization: fc.constantFrom('none', 'any', 'authenticated', 'conditioned'),
      seed: fc.integer(),
    })
    .chain((c) =>
      fc
        .tuple(
          fc.array(exprArb(c.target !== undefined, c.input), {
            minLength: c.preconditions,
            maxLength: c.preconditions,
          }),
          exprArb(false, false),
        )
        .map(([exprs, authExpr]) => ({ c, exprs, authExpr })),
    )
    .map(({ c, exprs, authExpr }) => {
      const id = `gen.cap${i}`
      const preconditions = exprs.map((expr, j) => ({
        id: `p${j}`,
        description: `condition ${j}`,
        expr,
      }))
      const guards: string[] = []
      if (c.guard && c.kind === 'action') {
        preconditions.push({ id: 'g', description: 'an opaque check', guard: true } as never)
        guards.push('g')
      }
      const def: Record<string, unknown> = {
        id,
        kind: c.kind,
        description: `${c.words.join(' ')} things`,
      }
      if (c.kind === 'query') Object.assign(def, { safe: true, effects: [] })
      if (c.target) def.target = c.target
      if (c.input || c.reference)
        def.input = {
          type: 'object',
          properties: {
            ...(c.input ? { x: { type: 'integer' } } : {}),
            ...(c.reference ? { ref: { type: 'string' } } : {}),
          },
        }
      if (c.reference) def.references = [{ name: 'ref', resource: c.reference, at: '/ref' }]
      if (preconditions.length) def.preconditions = preconditions
      if (c.authorization === 'any') def.authorization = { principal: 'any' }
      if (c.authorization === 'authenticated') def.authorization = { principal: 'authenticated' }
      if (c.authorization === 'conditioned')
        def.authorization = {
          principal: 'any',
          conditions: [{ id: 'a', description: 'a level', expr: authExpr }],
        }
      return { def, guards: guards.map((g) => ({ capability: id, id: g })) }
    })

export const manifestArb: fc.Arbitrary<Spec> = fc
  .integer({ min: 1, max: 6 })
  .chain((n) =>
    fc.record({
      caps: fc.tuple(...Array.from({ length: n }, (_, i) => capabilityArb(i))),
      alternatives: fc.subarray(TYPES),
      contains: fc.subarray(TYPES, { maxLength: 2 }),
      relations: fc.array(
        fc.record({
          type: fc.constantFrom('alternativeTo' as const, 'enables' as const, 'relatedTo' as const),
          from: fc.integer({ min: 0, max: n - 1 }),
          to: fc.integer({ min: 0, max: n - 1 }),
          namespaced: fc.boolean(),
        }),
        { maxLength: 6 },
      ),
      claims: fc.array(
        fc.record({
          on: fc.integer({ min: 0, max: n - 1 }),
          source: fc.constantFrom('owner', 'other'),
          kind: fc.constantFrom('recommendation' as const, 'benefit' as const),
          applies: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
        }),
        { maxLength: 4 },
      ),
    }),
  )
  .map(({ caps, alternatives, contains, relations, claims }) => {
    const capabilities = caps.map((c) => c.def)
    const manifest = {
      schemaVersion: '0.1',
      namespace: NS,
      provenance: { source: 'owner', basis: 'declared' },
      principal: { attributes: { type: 'object', properties: { level: { type: 'integer' } } } },
      sources: [
        { id: 'owner', role: 'owner', name: 'The owner' },
        { id: 'other', role: 'third-party', name: 'Someone else' },
      ],
      resources: TYPES.map((id, i) => ({
        id,
        description: `${WORDS[i]} resources`,
        key: 'id',
        attributes: {
          type: 'object',
          properties: { id: { type: 'string' }, n: { type: 'integer' }, s: { type: 'string' } },
        },
        ...(alternatives.includes(id) ? { alternatives: true } : {}),
        ...(i === 0 && contains.length ? { contains: contains.filter((t) => t !== id) } : {}),
      })),
      capabilities,
      relations: relations
        .filter((r) => r.from !== r.to)
        .map((r) => ({
          type: r.type,
          from: `${r.namespaced ? `${NS}#` : ''}gen.cap${r.from}`,
          to: `gen.cap${r.to}`,
          ...(r.type === 'relatedTo' ? { description: 'related' } : {}),
        })),
      claims: claims.map((k, i) => ({
        id: `k${i}`,
        subject: `gen.cap${k.on}`,
        kind: k.kind,
        statement: 'said about it',
        // a third party's claim is only as good as its evidence (RFC 0001 rule 3)
        provenance:
          k.source === 'owner'
            ? { source: 'owner', basis: 'declared' }
            : { source: 'other', basis: 'verified', evidence: [{ description: 'a report' }] },
        ...(k.applies !== undefined && capabilities[k.on]!.target
          ? { applies: { gt: [{ path: 'target.n' }, { value: k.applies }] } }
          : {}),
      })),
    } as unknown as CapabilityManifest
    if (!manifest.resources[0]!.contains?.length) delete manifest.resources[0]!.contains
    return { manifest, guards: caps.flatMap((c) => c.guards) }
  })
  .filter(({ manifest }) => validate(manifest).ok)

// instances: some visible, some the resolver returns null for, some whose load throws, listed or only reachable
// as the start
type Instance = { n: number; s?: string; fate: 'found' | 'none' | 'throws'; listed: boolean }
export const stateArb = fc.dictionary(
  fc.constantFrom(...TYPES),
  fc.array(
    fc.record({
      n: fc.integer({ min: 0, max: 3 }),
      s: fc.option(fc.constantFrom('x', 'y'), { nil: undefined }),
      fate: fc.constantFrom('found', 'found', 'found', 'none', 'throws'),
      listed: fc.boolean(),
    }),
    { maxLength: 4 },
  ),
)
export const resolverOf = (instances: Instance[] = [], listThrows = false): ResourceResolver => ({
  load: async (key) => {
    const i = instances[Number(key.slice(1))]
    if (!i || i.fate === 'none') return null
    if (i.fate === 'throws') throw new Error('down')
    return { attributes: { n: i.n, ...(i.s === undefined ? {} : { s: i.s }) } }
  },
  list: async () => {
    if (listThrows) throw new Error('down')
    return instances.flatMap((i, k) => (i.listed ? [`k${k}`] : []))
  },
})

export const policyArb: fc.Arbitrary<DiscoveryPolicy> = fc.record({
  id: fc.constant('generated'),
  description: fc.constant('a generated policy'),
  scope: fc.constantFrom('exhaustive' as const, 'start' as const, 'neighborhood' as const),
  depth: fc.integer({ min: 0, max: 2 }),
  order: fc.constantFrom('canonical' as const, 'relevance' as const, {
    byClaim: 'recommendation' as const,
  }),
  relevance: fc.option(fc.constant('basic'), { nil: undefined }),
  claims: fc.constantFrom('shown' as const, 'omitted' as const),
  budget: fc.option(fc.record({ offers: fc.integer({ min: 1, max: 5 }) }), { nil: undefined }),
})

export const caseArb = manifestArb.chain((spec) =>
  fc.record({
    spec: fc.constant(spec),
    state: stateArb,
    listThrows: fc.constantFrom(...TYPES, 'none'),
    guardResult: fc.constantFrom<unknown>(true, false, 'no', 'throw', 7),
    policy: policyArb,
    principal: fc.record({
      authenticated: fc.boolean(),
      attributes: fc.option(fc.record({ level: fc.integer({ min: 0, max: 3 }) }), { nil: {} }),
    }) as fc.Arbitrary<Principal>,
    request: fc.record({
      policy: fc.constantFrom(...builtInPolicies.map((p) => p.id), 'generated'),
      start: fc.option(
        fc.oneof(
          fc.record({
            type: fc.constantFrom(...TYPES),
            key: fc.constantFrom('k0', 'k1', 'k2', 'k9'),
          }),
          fc.constantFrom(...TYPES, 'gen.cap0', 'gen.cap3', 'nothing.here'),
        ),
        { nil: undefined },
      ),
      budget: fc.option(
        fc.record({
          offers: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
          depth: fc.option(fc.integer({ min: 0, max: 2 }), { nil: undefined }),
        }),
        { nil: undefined },
      ),
      task: fc.option(
        fc.subarray(WORDS, { minLength: 1 }).map((w) => ({ statement: w.join(' ') })),
        { nil: undefined },
      ),
    }),
  }),
)
export type Case = typeof caseArb extends fc.Arbitrary<infer C> ? C : never

// run, when given, is every query's and action's handler
export const runtimeOf = (c: Case, manifest = c.spec.manifest, run?: Handler['run']) => {
  const guard: GuardImpl = () => {
    if (c.guardResult === 'throw') throw new Error('down')
    return c.guardResult as boolean
  }
  const handlers: Record<string, Handler> = {}
  for (const g of c.spec.guards) (handlers[g.capability] ??= { guards: {} }).guards![g.id] = guard
  if (run)
    for (const cap of manifest.capabilities)
      if (cap.kind !== 'event') handlers[cap.id] = { ...handlers[cap.id], run }
  return testRuntime({
    manifest,
    resources: Object.fromEntries(
      TYPES.map((t) => [t, resolverOf(c.state[t], c.listThrows === t)]),
    ),
    handlers,
    policies: [c.policy],
  })
}
export const requestOf = (c: Case): ProjectionRequest => {
  const r: ProjectionRequest = { principal: c.principal, policy: c.request.policy }
  if (c.request.start !== undefined) r.start = c.request.start
  if (c.request.task) r.task = c.request.task
  if (c.request.budget) {
    const b: { offers?: number; depth?: number } = {}
    if (c.request.budget.offers !== undefined) b.offers = c.request.budget.offers
    if (c.request.budget.depth !== undefined) b.depth = c.request.budget.depth
    r.budget = b
  }
  return r
}
