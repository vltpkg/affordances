import {
  decodePointer,
  all,
  byCanonical,
  canonicalJson,
  compare,
  digestOf,
  evaluate,
  resolvePath,
  validate,
  type CapabilityDefinition,
  type CapabilityManifest,
  type Condition,
  type Context,
  type Expr,
  type Id,
  type Truth,
  applyDefaults,
  renderConfirmation as render,
} from '@affordances/ir'
import { attributesFor } from './data.ts'
import { decideCondition, guardTruth, instancesOf } from './decide.ts'
import { factsOf } from './facts.ts'
import type { Loaded, Read, Session } from './session.ts'
import { executor } from './execute.ts'
import { offerId } from './offer-id.ts'
import { BUILT_IN, views } from './views.ts'
import type {
  Availability,
  CapabilityOffer,
  ChoiceSet,
  ClaimView,
  ConditionResult,
  DiscoveryPolicy,
  Handler,
  OfferId,
  PolicyId,
  Principal,
  Projection,
  ProjectionRequest,
  Requirements,
  ResourceRef,
  ResourceResolver,
  Runtime,
  TokenStore,
} from './types.ts'

export type RuntimeOptions = {
  manifest: CapabilityManifest
  // one per resource type the manifest declares (RFC 0002 §2.1)
  resources: Record<Id, ResourceResolver>
  // by capability id: a run for each query and action, and an implementation for each guard it declares (§11)
  handlers?: Record<Id, Handler>
  policies?: DiscoveryPolicy[] // added to the built-in four (§6.1)
  defaultPolicy?: PolicyId // 'resource' unless set
  approvalKeys?: { current: CryptoKey; previous?: CryptoKey } // HMAC keys for approval tokens (§8.2)
  seenTokens?: TokenStore // each token's nonce, so a token runs once (§8.2)
  approvalTtlMs?: number // how long an approval holds: five minutes unless set
  now?: () => number // the clock approvals expire by; Date.now unless set
}

type Obj = Record<string, unknown>

// an instance as a revision reads it (§7): its resolver's version, or the digest of its attributes when it gives none
const read = async (type: Id, key: string, loaded: Loaded): Promise<Read | undefined> => {
  if (loaded.state === 'none') return
  if (loaded.state === 'failed') return { type, key }
  return { type, key, version: loaded.version ?? (await digestOf(loaded.attributes)) }
}

// §7: instances sorted by type, then key, in UTF-16 code units, ties broken by RFC 8785 bytes (RFC 0001 §7.2)
const byRead = (a: Read, b: Read) =>
  compare(a.type, b.type) || compare(a.key, b.key) || byCanonical(a, b)

// the paths an expression reads, a quantifier's `of` included
const paths = (expr: Expr): string[] => {
  if ('all' in expr) return expr.all.flatMap(paths)
  if ('any' in expr) return expr.any.flatMap(paths)
  if ('not' in expr) return paths(expr.not)
  if ('exists' in expr) return [expr.exists]
  if ('some' in expr) return [expr.some.of, ...paths(expr.some.where)]
  if ('every' in expr) return [expr.every.of, ...paths(expr.every.where)]
  const [a, b] = Object.values(expr)[0] as [object, object]
  return [a, b].flatMap((o) => ('path' in o ? [o.path] : 'count' in o ? [o.count] : [])) as string[]
}

// canonical order: capability ids, then target type and key, then bound references (§6.4)
const order = (o: CapabilityOffer) => [
  o.capability,
  o.target?.type ?? '',
  o.target?.key ?? '',
  o.with ?? {},
]
const canonically = (a: CapabilityOffer, b: CapabilityOffer) => {
  const [x, y] = [order(a), order(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return compare(x[i] as string, y[i] as string)
  return byCanonical(x[3], y[3])
}

// §4.2: a capability takes input when its input schema declares a property, or isn't an object schema
// what the runtime fills in itself is never the caller's to give: the target's key at targetAt, and each bound
// reference's key at its at (§8.1 step 4). Only a top-level property can be left out this way
const topLevel = (pointer: string) => {
  const keys = decodePointer(pointer)
  return keys.length === 1 ? keys[0] : undefined
}
const takes = (c: CapabilityDefinition, bound: Record<string, string> = {}) => {
  const input = c.input as { type?: unknown; properties?: Obj } | boolean | undefined
  if (input === undefined) return false
  if (typeof input !== 'object') return true
  if (input.type !== 'object') return true
  const filled = new Set<string | undefined>()
  if (c.target && c.targetAt) filled.add(topLevel(c.targetAt))
  for (const r of c.references ?? []) if (bound[r.name] !== undefined) filled.add(topLevel(r.at))
  return Object.keys(input.properties ?? {}).some((k) => !filled.has(k))
}

// a path the context doesn't supply (RFC 0001 §3.1's missing): its root isn't there, or the root's attribute isn't.
// input and item are supplied whole, so a key they lack is absent, never missing
const missing = (path: string, context: Context) =>
  !path.startsWith('input.') &&
  !/^item\b/.test(path) &&
  resolvePath(path, context).kind === 'missing'

// terminology §2.4: derived, never declared
const consequential = (c: CapabilityDefinition) =>
  c.kind === 'action' &&
  (c.effects === undefined ||
    c.effects.some((e) => e.category !== 'state' || e.reversibility === 'irreversible'))

export const createRuntime = ({
  manifest,
  resources,
  handlers = {},
  policies: added = [],
  defaultPolicy = 'resource',
  approvalKeys,
  seenTokens,
  approvalTtlMs = 5 * 60_000,
  now = Date.now,
}: RuntimeOptions): Runtime => {
  const policies = new Map<PolicyId, DiscoveryPolicy>()
  for (const p of [...BUILT_IN, ...added]) {
    if (policies.has(p.id)) throw new Error(`two discovery policies are named ${p.id}`)
    policies.set(p.id, p)
  }
  if (!policies.has(defaultPolicy)) throw new Error(`no discovery policy ${defaultPolicy}`)
  const checked = validate(manifest)
  if (!checked.ok)
    throw new Error(
      `the manifest isn't valid: ${checked.issues
        .filter((i) => i.code.startsWith('E_'))
        .map((i) => `${i.code} at ${i.at}`)
        .join(', ')}`,
    )
  for (const r of manifest.resources)
    if (!resources[r.id]) throw new Error(`no resolver for the resource type ${r.id}`)
  // every declared guard has an implementation (§11: createRuntime checks at startup)
  for (const c of manifest.capabilities)
    for (const x of [...(c.preconditions ?? []), ...(c.authorization?.conditions ?? [])])
      if ('guard' in x && typeof handlers[c.id]?.guards?.[x.id] !== 'function')
        throw new Error(`no implementation for ${c.id}'s guard ${x.id}`)
  // every query and action has a handler that runs it (§11)
  for (const c of manifest.capabilities)
    if (c.kind !== 'event' && typeof handlers[c.id]?.run !== 'function')
      throw new Error(`no handler runs ${c.id}`)
  // a confirmation needs keys to sign approvals and a store to use each once (§8.2)
  const confirming = manifest.capabilities.find((c) => c.confirmation)
  if (confirming && (!approvalKeys || !seenTokens))
    throw new Error(
      `${confirming.id} requires confirmation: give createRuntime approvalKeys and seenTokens`,
    )
  // a definition's own id, for a Ref that may name it with the manifest's namespace (RFC 0001 §2)
  // what depends on the manifest alone, found once
  const facts = factsOf(manifest)
  const types = new Map(manifest.resources.map((r) => [r.id, r]))
  const attributesOf = attributesFor(manifest)
  const sources = new Map(manifest.sources.map((s) => [s.id, s]))
  const declared = Object.keys(
    (manifest.principal?.attributes as { properties?: Obj } | undefined)?.properties ?? {},
  )

  // what one request reads, shared by projection and execution: the principal's declared attributes, the instances
  // loaded (each once), the guards run, and an offer computed as a projection computes it
  const session = async (principal: Principal): Promise<Session> => {
    // the declared attributes only: anything else is ignored (§3)
    const attributes = Object.fromEntries(
      declared
        .filter((k) => Object.hasOwn(principal.attributes, k))
        .map((k) => [k, principal.attributes[k]]),
    )
    const base = {
      manifest: await facts.manifestDigest,
      principal: await digestOf({ authenticated: principal.authenticated, attributes }),
    }

    // each instance this request reads: loaded once, and read for a revision (its version or its attributes' digest)
    // once
    const entries = new Map<
      string,
      { type: Id; key: string; loaded: Promise<Loaded>; read?: Promise<Read | undefined> }
    >()
    const entry = (type: Id, key: string) => {
      const at = canonicalJson([type, key])
      let found = entries.get(at)
      if (!found) {
        found = {
          type,
          key,
          loaded: (async (): Promise<Loaded> => {
            try {
              const given = await resources[type]!.load(key, principal)
              if (!given) return { state: 'none' }
              // attributes that aren't plain data fitting the type's schema are attributes it couldn't supply
              const fitting = attributesOf(type, given.attributes)
              if (!fitting) return { state: 'failed' }
              return typeof given.version === 'string'
                ? { state: 'found', attributes: fitting, version: given.version }
                : { state: 'found', attributes: fitting }
            } catch {
              return { state: 'failed' }
            }
          })(),
        }
        entries.set(at, found)
      }
      return found
    }
    const load = (type: Id, key: string) => entry(type, key).loaded
    const reading = (type: Id, key: string) => {
      const e = entry(type, key)
      return (e.read ??= e.loaded.then((loaded) => read(type, key, loaded)))
    }
    // the instances each offer read, so a projection's revision is over what its own offers read, whatever else a
    // shared session has loaded
    const readsOf = new WeakMap<CapabilityOffer, Read[]>()
    const readsFor = (offers: CapabilityOffer[]) => {
      const union = new Map<string, Read>()
      for (const o of offers)
        for (const r of readsOf.get(o) ?? []) union.set(canonicalJson([r.type, r.key]), r)
      return [...union.values()].toSorted(byRead)
    }
    // every instance read so far, as revisions read them, sorted by type and key (§7)
    const readAll = async () => {
      const collected: Read[] = []
      for (const e of entries.values()) {
        const r = await reading(e.type, e.key)
        if (r) collected.push(r)
      }
      return collected.toSorted(byRead)
    }
    // every guard run at projection time, for the projection's revision (§7)
    const guardLog: { capability: Id; condition: string; value: boolean | string | null }[] = []

    // bind: reference names to keys, for the references the offer binds
    const offerOn = async (
      c: CapabilityDefinition,
      target: ResourceRef | undefined,
      bind: Record<string, string> = {},
    ): Promise<CapabilityOffer | undefined> => {
      const reads: Read[] = []
      const context: Context = { principal: attributes, references: {} }
      if (target) {
        const loaded = await load(target.type, target.key)
        // an instance the resolver doesn't return isn't there for this principal
        if (loaded.state === 'none') return
        if (loaded.state === 'found') context.target = loaded.attributes
        reads.push((await reading(target.type, target.key))!)
      }
      // a reference is bound when its key is known and the instance is there
      const bound: Record<string, string> = {}
      for (const r of c.references ?? []) {
        const key = bind[r.name]
        if (key === undefined) continue
        const loaded = await load(r.resource, key)
        if (loaded.state === 'none') continue
        bound[r.name] = key
        if (loaded.state === 'found') context.references![r.name] = loaded.attributes
        reads.push((await reading(r.resource, key))!)
      }

      // conditions, then requirements, then availability in RFC 0002 §4.2's order
      // a guard that threw, or returned something else, is null: unknown
      const guardsRun: { condition: string; value: boolean | string | null }[] = []
      const takesInput = takes(c, bound)
      // why each condition is unknown when it is: only for input, or for something else
      const forInput = new Set<string>()
      // authorization never reads the input (RFC 0001 §3.2), so its guards never wait on it
      const result = async (x: Condition, authorizing = false): Promise<ConditionResult> => {
        const r: ConditionResult = { id: x.id, description: x.description, value: 'unknown' }
        // §4.2: a guard runs with no input, unless it's execution-only; a throw is unknown
        const d = await decideCondition(
          x,
          context,
          handlers[c.id]?.guards?.[x.id],
          { input: undefined, target: targetArg, refs, principal },
          { withInput: false },
        )
        r.value = d.value
        if (d.detail !== undefined) r.detail = d.detail
        if ('expr' in x) {
          // needs-input only when every path that's missing is on the input
          const pathsRead = paths(x.expr)
          if (
            r.value === 'unknown' &&
            pathsRead.some((path) => path.startsWith('input.')) &&
            pathsRead.every((path) => !missing(path, context))
          )
            forInput.add(x.id)
          return r
        }
        if (d.guard !== undefined) {
          guardsRun.push({ condition: x.id, value: d.guard })
          guardLog.push({ capability: c.id, condition: x.id, value: d.guard })
        }
        // not ruled out: true when there's no input to wait for, unknown for input otherwise. authorization never
        // reads the input, so its guards never wait on it
        if (r.value === true && takesInput && !authorizing) {
          r.value = 'unknown'
          forInput.add(x.id)
        }
        return r
      }
      const targetArg =
        target && context.target ? { key: target.key, attributes: context.target } : undefined
      const refs = Object.fromEntries(
        (c.references ?? []).map((r) => [
          r.name,
          bound[r.name] !== undefined && context.references![r.name]
            ? { key: bound[r.name]!, attributes: context.references![r.name]! }
            : undefined,
        ]),
      )
      const conditions: ConditionResult[] = []
      for (const x of c.preconditions ?? []) conditions.push(await result(x))
      let authorization: Truth | undefined
      if (c.authorization) {
        if (c.authorization.principal === 'authenticated' && !principal.authenticated)
          authorization = false
        else {
          const values: Truth[] = []
          for (const x of c.authorization.conditions ?? [])
            values.push((await result(x, true)).value)
          authorization = all(values)
        }
      }
      const requirements: Requirements = {
        authorization:
          authorization === undefined
            ? 'none-declared'
            : authorization === true
              ? 'met'
              : authorization === false
                ? 'unmet'
                : 'unknown',
      }
      if (c.confirmation)
        // the effective input as far as it's known before the agent supplies any: the schema's defaults, so a default's
        // charge shows before it's approved. Known only in part: a key the agent hasn't given is
        // missing, so a charge conditioned on it shows as may apply, never dropped (review's boundary #1)
        requirements.confirmation = {
          summary: render(c.confirmation.summary, c.effects, {
            ...context,
            input: applyDefaults(c.input, undefined) as Record<string, unknown>,
            partialInput: true,
          }),
        }
      const availability = ((): Availability => {
        if (authorization === undefined) return { status: 'unknown', because: ['authorization'] }
        if (authorization === false) return { status: 'needs-authorization' }
        if (authorization === 'unknown') return { status: 'unknown', because: ['authorization'] }
        const value = all(conditions.map((x) => x.value))
        if (value === false)
          return {
            status: 'unavailable',
            because: conditions.filter((x) => x.value === false).map((x) => x.id),
          }
        if (value === 'unknown') {
          const unknown = conditions.filter((x) => x.value === 'unknown')
          if (unknown.every((x) => forInput.has(x.id))) {
            const inputs = (c.preconditions ?? [])
              .filter((x) => forInput.has(x.id) && 'expr' in x)
              .flatMap((x) => paths((x as { expr: Expr }).expr))
              .filter((path) => path.startsWith('input.'))
            return { status: 'needs-input', inputs: [...new Set(inputs)].toSorted() }
          }
          return { status: 'unknown', because: unknown.map((x) => x.id) }
        }
        return { status: 'available' }
      })()

      const claims: ClaimView[] = facts
        .claims(c.id)
        .filter((k) => !k.applies || evaluate(k.applies, { target: context.target }) !== false)
        .map((k) => {
          const source = sources.get(k.provenance.source)!
          const view: ClaimView = {
            id: k.id,
            kind: k.kind,
            statement: k.statement,
            source: { id: source.id, name: source.name, role: source.role },
            basis: k.provenance.basis,
          }
          if (k.quantity) view.quantity = k.quantity
          if (k.cites) view.cites = [...k.cites]
          return view
        })

      reads.sort(byRead)
      const offer: CapabilityOffer = {
        id: offerId({
          capability: c.id,
          target,
          with: Object.keys(bound).length ? bound : undefined,
        }),
        capability: c.id,
        revision: await digestOf({
          ...base,
          resources: reads,
          guards: guardsRun.toSorted((a, b) => compare(a.condition, b.condition)),
        }),
        availability,
        conditions,
        requirements,
        consequential: consequential(c),
        claims,
        relevance: { level: 'undetermined' },
        alternatives: { count: facts.partners(c.id).size },
      }
      if (target) offer.target = target
      if (Object.keys(bound).length) offer.with = bound
      if (target && types.get(target.type)?.alternatives) offer.choiceSet = `${c.id}@${target.type}`
      readsOf.set(offer, reads)
      return offer
    }

    // an offer's revision alone (§7), as offerOn computes it but without the rest of the offer, and without adding to
    // the projection's guard log: for execution's refusals and freshness
    const revisionOf = async (
      c: CapabilityDefinition,
      target: ResourceRef | undefined,
      bind: Record<string, string> = {},
    ): Promise<string | undefined> => {
      const reads: Read[] = []
      let targetArg: { key: string; attributes: Obj } | undefined
      if (target) {
        const loaded = await load(target.type, target.key)
        if (loaded.state === 'none') return
        if (loaded.state === 'found') targetArg = { key: target.key, attributes: loaded.attributes }
        reads.push((await reading(target.type, target.key))!)
      }
      const refs: Record<string, { key: string; attributes: Obj } | undefined> = {}
      for (const r of c.references ?? []) {
        const key = bind[r.name]
        if (key === undefined) {
          refs[r.name] = undefined
          continue
        }
        const loaded = await load(r.resource, key)
        if (loaded.state === 'none') {
          refs[r.name] = undefined
          continue
        }
        refs[r.name] = loaded.state === 'found' ? { key, attributes: loaded.attributes } : undefined
        reads.push((await reading(r.resource, key))!)
      }
      // the guards offerOn runs: every precondition's, and authorization's when it gets that far
      const conditions = [
        ...(c.preconditions ?? []),
        ...(c.authorization &&
        !(c.authorization.principal === 'authenticated' && !principal.authenticated)
          ? (c.authorization.conditions ?? [])
          : []),
      ]
      const guardsRun: { condition: string; value: boolean | string | null }[] = []
      for (const x of conditions) {
        const guard = 'guard' in x ? handlers[c.id]?.guards?.[x.id] : undefined
        if (!guard || guard.executionOnly) continue
        guardsRun.push({
          condition: x.id,
          value: await guardTruth(guard, { input: undefined, target: targetArg, refs, principal }),
        })
      }
      return digestOf({
        ...base,
        resources: reads.toSorted(byRead),
        guards: guardsRun.toSorted((a, b) => compare(a.condition, b.condition)),
      })
    }
    return { attributes, base, load, reading, readAll, readsFor, guardLog, offerOn, revisionOf }
  }

  // a projection, in its own session or one an execution shares with it
  const project = async (request: ProjectionRequest, shared?: Session): Promise<Projection> => {
    const { principal } = request
    const { base, readsFor, guardLog, offerOn, load } = shared ?? (await session(principal))
    // the guards this projection runs, from where the log stands now
    const guardsFrom = guardLog.length
    const start = typeof request.start === 'object' ? request.start : undefined
    // a reference is bound when the request starts from an instance of its type
    // a reference is bound from the start instance, or else from the first bind instance of its type. offerOn loads
    // each as the request's principal, and one it can't load binds nothing (§2)
    const startBinding = (c: CapabilityDefinition) =>
      Object.fromEntries(
        (c.references ?? []).flatMap((r) => {
          if (start?.type === r.resource) return [[r.name, start.key]]
          // exactly one bind instance of the type binds; two of one type bind neither, so the list's order never
          // decides which
          const ofType = (request.bind ?? []).filter((b) => b.type === r.resource)
          return ofType.length === 1 ? [[r.name, ofType[0]!.key]] : []
        }),
      )

    // every offer the principal may see: a global capability once, a targeted one on each instance its resolver lists,
    // and on the start instance. events are announced, not invoked, so they have no offers
    // the resolvers are called concurrently, and the offers sorted after, so the bytes don't depend on which answered
    // first
    const lists = await Promise.all(
      manifest.capabilities.map(async (c) => {
        if (c.kind === 'event') return []
        if (!c.target) return [await offerOn(c, undefined, startBinding(c))]
        const target = c.target
        const keys = await instancesOf(
          resources[target]!,
          principal,
          c.id,
          start?.type === target ? start.key : undefined,
        )
        return Promise.all(keys.map((key) => offerOn(c, { type: target, key }, startBinding(c))))
      }),
    )
    const offers = lists.flat().filter((o): o is CapabilityOffer => o !== undefined)
    offers.sort(canonically)

    // §5: the offers of one capability over every instance of a type with alternatives
    const sets = new Map<string, ChoiceSet>()
    for (const o of offers) {
      if (!o.choiceSet) continue
      const set = sets.get(o.choiceSet) ?? {
        id: o.choiceSet,
        capability: o.capability,
        over: o.target!.type,
        members: [],
        order: { by: 'canonical' },
      }
      set.members.push(o.id)
      sets.set(o.choiceSet, set)
    }
    const choiceSets = [...sets.values()].toSorted((a, b) => compare(a.id, b.id))
    // §6.6: each member's target attributes, from the loads its offer already made, for its set's comparison
    const memberAttributes = new Map<OfferId, Record<string, unknown> | undefined>()
    const byOfferId = new Map(offers.map((o) => [o.id, o]))
    for (const set of choiceSets)
      for (const id of set.members) {
        const { target } = byOfferId.get(id)!
        const loaded = await load(target!.type, target!.key)
        memberAttributes.set(id, loaded.state === 'found' ? loaded.attributes : undefined)
      }

    // §7: every instance this projection read, sorted by type and key
    const everyRead = readsFor(offers)
    const revision = await digestOf({
      ...base,
      resources: everyRead,
      guards: guardLog
        .slice(guardsFrom)
        .toSorted(
          (a, b) =>
            compare(a.capability, b.capability) ||
            compare(a.condition, b.condition) ||
            byCanonical(a, b),
        ),
    })

    // what's shown first, and how to find the rest (§6)
    const policyId = request.policy ?? defaultPolicy
    const policy = policies.get(policyId)
    if (!policy) throw new Error(`no discovery policy ${policyId}`)
    const shown = views({
      manifest,
      facts,
      request,
      policy,
      revision,
      offers,
      choiceSets,
      memberAttributes,
    })
    return {
      revision,
      offers,
      choiceSets,
      view: shown.view,
      expand: async (expansion, options) => shown.expand(expansion, options),
      inspect: async (id) => {
        const details = shown.inspect(id)
        if (!details) throw new Error(`no offer ${id} in this projection`)
        return details
      },
      // runtime-internal: it holds what a view omits, so it never goes on a wire (RFC 0002 §11). views do
      toJSON() {
        throw new TypeError('a projection is runtime-internal: serialize its view() instead')
      },
    }
  }

  const { check, execute } = executor({
    manifest,
    facts,
    resources,
    project: (request, shared) => project(request, shared),
    handlers,
    session,
    approval: { keys: approvalKeys, store: seenTokens, ttlMs: approvalTtlMs, now },
  })
  return { manifest, project: (request) => project(request), check, execute }
}
