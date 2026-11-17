import {
  canonicalJson,
  digest,
  evaluate,
  validate,
  type CapabilityDefinition,
  type CapabilityManifest,
  type Context,
  type Expr,
  type Id,
  type Truth,
} from '@affordances/ir'
import { digestOf } from './digest.ts'
import { offerId } from './offer-id.ts'
import { BUILT_IN, views } from './views.ts'
import type {
  Availability,
  CapabilityOffer,
  ChoiceSet,
  ClaimView,
  ConditionResult,
  Projection,
  ProjectionRequest,
  Requirements,
  ResourceRef,
  DiscoveryPolicy,
  Handler,
  PolicyId,
  ResourceResolver,
  Runtime,
} from './types.ts'

export type RuntimeOptions = {
  manifest: CapabilityManifest
  // one per resource type the manifest declares (RFC 0002 §2.1)
  resources: Record<Id, ResourceResolver>
  // by capability id: an implementation for each guard it declares (§11). execution's run arrives with M3d
  handlers?: Record<Id, Handler>
  policies?: DiscoveryPolicy[] // added to the built-in four (§6.1)
  defaultPolicy?: PolicyId // 'resource' unless set
}

type Obj = Record<string, unknown>
// what a projection read of one instance: its attributes, none (it doesn't exist, or the principal may not see it),
// or a resolver that threw, whose attributes are then unknown (§2.1)
type Loaded =
  | { state: 'found'; attributes: Obj; version?: string }
  | { state: 'none' }
  | { state: 'failed' }
// one instance as a revision reads it (§7): a resolver that threw has no version, which no version string equals
type Read = { type: Id; key: string; version?: string }

// RFC 8785 bytes in code-point order: canonical order's tie-break (RFC 0001 §7.2)
const byBytes = (a: unknown, b: unknown) => {
  const x = canonicalJson(a)
  const y = canonicalJson(b)
  return x < y ? -1 : x > y ? 1 : 0
}
const codePoints = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
// §7: instances sorted by type, then key
const byRead = (a: Read, b: Read) =>
  codePoints(a.type, b.type) || codePoints(a.key, b.key) || byBytes(a, b)
const all = (values: Truth[]): Truth =>
  values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true

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

// RFC 0001 §3.2: strings as written, other values as their RFC 8785 text, an unresolved path as `unknown`
const render = (summary: string, context: Context) =>
  summary.replaceAll(/\{\{|\}\}|\{([^{}]*)\}/g, (whole, path: string | undefined) => {
    if (path === undefined) return whole[0]!
    const [root, ...rest] = path.split('.')
    let value: unknown =
      root === 'target' || root === 'input' ? context[root] : context.references?.[root!]
    for (const key of rest)
      value =
        value !== null && typeof value === 'object' && Object.hasOwn(value, key)
          ? (value as Obj)[key]
          : undefined
    return value === undefined
      ? 'unknown'
      : typeof value === 'string'
        ? value
        : canonicalJson(value)
  })

// canonical order: capability ids, then target type and key, then bound references (§6.4)
const order = (o: CapabilityOffer) => [
  o.capability,
  o.target?.type ?? '',
  o.target?.key ?? '',
  o.with ?? {},
]
const canonically = (a: CapabilityOffer, b: CapabilityOffer) => {
  const [x, y] = [order(a), order(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return codePoints(x[i] as string, y[i] as string)
  return byBytes(x[3], y[3])
}

// §4.2: a capability takes input when its input schema declares a property, or isn't an object schema
const takes = (c: CapabilityDefinition) => {
  const input = c.input as { type?: unknown; properties?: Obj } | boolean | undefined
  if (input === undefined) return false
  if (typeof input !== 'object') return true
  return input.type !== 'object' || Object.keys(input.properties ?? {}).length > 0
}

// a path the context doesn't supply (RFC 0001 §3.1's missing): its root isn't there, or the root's attribute isn't.
// inside a value supplied whole, an omitted key is absent instead, and input and item are supplied whole
const missing = (path: string, context: Context) => {
  const [root, attribute] = path.split('.')
  if (root === 'input' || root === 'item') return false
  const value =
    root === 'target' || root === 'principal' ? context[root] : context.references?.[root!]
  return value === undefined || (attribute !== undefined && !Object.hasOwn(value, attribute))
}

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
  // a definition's own id, for a Ref that may name it with the manifest's namespace (RFC 0001 §2)
  const local = (ref: string) =>
    ref.startsWith(`${manifest.namespace}#`) ? ref.slice(manifest.namespace.length + 1) : ref
  const types = new Map(manifest.resources.map((r) => [r.id, r]))
  const sources = new Map(manifest.sources.map((s) => [s.id, s]))
  const declared = Object.keys(
    (manifest.principal?.attributes as { properties?: Obj } | undefined)?.properties ?? {},
  )
  // alternativeTo runs both ways (RFC 0001 §5.1)
  const partners = new Map<string, Set<string>>()
  for (const r of manifest.relations ?? [])
    if (r.type === 'alternativeTo')
      for (const [a, b] of [
        [local(r.from), local(r.to)],
        [local(r.to), local(r.from)],
      ] as const)
        partners.set(a, (partners.get(a) ?? new Set()).add(b))
  const manifestDigest = digest(manifest)

  const project = async (request: ProjectionRequest): Promise<Projection> => {
    const { principal } = request
    // the declared attributes only: anything else is ignored (§3)
    const attributes = Object.fromEntries(
      declared
        .filter((k) => Object.hasOwn(principal.attributes, k))
        .map((k) => [k, principal.attributes[k]]),
    )
    const base = {
      manifest: await manifestDigest,
      principal: await digestOf({ authenticated: principal.authenticated, attributes }),
    }

    const loads = new Map<string, Promise<Loaded>>()
    const load = (type: Id, key: string) => {
      const at = canonicalJson([type, key])
      let loaded = loads.get(at)
      if (!loaded) {
        loaded = (async (): Promise<Loaded> => {
          try {
            const found = await resources[type]!.load(key, principal)
            return found ? { state: 'found', ...found } : { state: 'none' }
          } catch {
            return { state: 'failed' }
          }
        })()
        loads.set(at, loaded)
      }
      return loaded
    }
    const read = async (type: Id, key: string, loaded: Loaded): Promise<Read | undefined> => {
      if (loaded.state === 'none') return
      if (loaded.state === 'failed') return { type, key }
      return { type, key, version: loaded.version ?? (await digestOf(loaded.attributes)) }
    }
    const start = typeof request.start === 'object' ? request.start : undefined
    // every guard run at projection time, for the projection's revision (§7)
    const guardLog: { capability: Id; condition: string; value: boolean | string | null }[] = []

    const offerOn = async (
      c: CapabilityDefinition,
      target: ResourceRef | undefined,
    ): Promise<CapabilityOffer | undefined> => {
      const reads: Read[] = []
      const context: Context = { principal: attributes, references: {} }
      if (target) {
        const loaded = await load(target.type, target.key)
        // an instance the resolver doesn't return isn't there for this principal
        if (loaded.state === 'none') return
        if (loaded.state === 'found') context.target = loaded.attributes
        reads.push((await read(target.type, target.key, loaded))!)
      }
      // a reference is bound when the request starts from an instance of its type
      const bound: Record<string, string> = {}
      for (const r of c.references ?? []) {
        if (start?.type !== r.resource) continue
        const loaded = await load(start.type, start.key)
        if (loaded.state === 'none') continue
        bound[r.name] = start.key
        if (loaded.state === 'found') context.references![r.name] = loaded.attributes
        reads.push((await read(start.type, start.key, loaded))!)
      }

      // conditions, then requirements, then availability in RFC 0002 §4.2's order
      // a guard that threw, or returned something else, is null: unknown
      const guardsRun: { condition: string; value: boolean | string | null }[] = []
      const takesInput = takes(c)
      // why each condition is unknown when it is: only for input, or for something else
      const forInput = new Set<string>()
      // authorization never reads the input (RFC 0001 §3.2), so its guards never wait on it
      const result = async (
        x: { id: string; description: string; expr?: Expr },
        authorizing = false,
      ): Promise<ConditionResult> => {
        const r: ConditionResult = { id: x.id, description: x.description, value: 'unknown' }
        if (x.expr) {
          r.value = evaluate(x.expr, context)
          // needs-input only when every path that's missing is on the input (review of M3a)
          const reading = paths(x.expr)
          if (
            r.value === 'unknown' &&
            reading.some((path) => path.startsWith('input.')) &&
            reading.every((path) => !missing(path, context))
          )
            forInput.add(x.id)
          return r
        }
        // §4.2: a guard runs with no input, unless it's execution-only; a throw is unknown
        const guard = handlers[c.id]?.guards?.[x.id]
        if (!guard || guard.executionOnly) return r
        let value: boolean | string | null
        try {
          value = await guard({ input: undefined, target: targetArg, refs, principal })
          if (typeof value !== 'boolean' && typeof value !== 'string') value = null
        } catch {
          value = null
        }
        guardsRun.push({ condition: x.id, value })
        guardLog.push({ capability: c.id, condition: x.id, value })
        if (value === false) r.value = false
        else if (typeof value === 'string') {
          r.value = false
          r.detail = value
        } else if (value === true) {
          // not ruled out: true when there's no input to wait for, unknown for input otherwise
          if (takesInput && !authorizing) forInput.add(x.id)
          else r.value = true
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
      for (const x of c.preconditions ?? []) conditions.push(await result(x as never))
      let authorization: Truth | undefined
      if (c.authorization) {
        if (c.authorization.principal === 'authenticated' && !principal.authenticated)
          authorization = false
        else {
          const values: Truth[] = []
          for (const x of c.authorization.conditions ?? [])
            values.push((await result(x as never, true)).value)
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
        requirements.confirmation = { summary: render(c.confirmation.summary, context) }
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

      const claims: ClaimView[] = (manifest.claims ?? [])
        .filter(
          (k) =>
            local(k.subject) === c.id &&
            (!k.applies || evaluate(k.applies, { target: context.target }) !== false),
        )
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
          guards: guardsRun.toSorted((a, b) => codePoints(a.condition, b.condition)),
        }),
        availability,
        conditions,
        requirements,
        consequential: consequential(c),
        claims,
        relevance: { level: 'undetermined' },
        alternatives: { count: partners.get(c.id)?.size ?? 0 },
      }
      if (target) offer.target = target
      if (Object.keys(bound).length) offer.with = bound
      if (target && types.get(target.type)?.alternatives) offer.choiceSet = `${c.id}@${target.type}`
      return offer
    }

    // every offer the principal may see: a global capability once, a targeted one on each instance its resolver lists,
    // and on the start instance. events are announced, not invoked, so they have no offers
    const offers: CapabilityOffer[] = []
    for (const c of manifest.capabilities) {
      if (c.kind === 'event') continue
      if (!c.target) {
        const offer = await offerOn(c, undefined)
        if (offer) offers.push(offer)
        continue
      }
      const keys = new Set<string>()
      if (start?.type === c.target) keys.add(start.key)
      try {
        for (const key of (await resources[c.target]!.list?.(principal, { capability: c.id })) ??
          [])
          keys.add(key)
      } catch {
        // a list that throws enumerates nothing beyond the start
      }
      for (const key of keys) {
        const offer = await offerOn(c, { type: c.target, key })
        if (offer) offers.push(offer)
      }
    }
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
    const choiceSets = [...sets.values()].toSorted((a, b) => codePoints(a.id, b.id))

    // §7: every instance this projection read, sorted by type and key
    const everyRead: Read[] = []
    for (const [at, loaded] of loads) {
      const [type, key] = JSON.parse(at) as [Id, string]
      const r = await read(type, key, await loaded)
      if (r) everyRead.push(r)
    }
    everyRead.sort(byRead)
    const revision = await digestOf({
      ...base,
      resources: everyRead,
      guards: guardLog.toSorted(
        (a, b) =>
          codePoints(a.capability, b.capability) ||
          codePoints(a.condition, b.condition) ||
          byBytes(a, b),
      ),
    })

    // what's shown first, and how to find the rest (§6)
    const policyId = request.policy ?? defaultPolicy
    const policy = policies.get(policyId)
    if (!policy) throw new Error(`no discovery policy ${policyId}`)
    const shown = views({ manifest, request, policy, revision, offers, choiceSets })
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

  return { manifest, project }
}
