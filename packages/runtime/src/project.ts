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
  ResourceResolver,
  Runtime,
  View,
} from './types.ts'

export type RuntimeOptions = {
  manifest: CapabilityManifest
  // one per resource type the manifest declares (RFC 0002 §2.1)
  resources: Record<Id, ResourceResolver>
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

// terminology §2.4: derived, never declared
const consequential = (c: CapabilityDefinition) =>
  c.kind === 'action' &&
  (c.effects === undefined ||
    c.effects.some((e) => e.category !== 'state' || e.reversibility === 'irreversible'))

export const createRuntime = ({ manifest, resources }: RuntimeOptions): Runtime => {
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
        [r.from, r.to],
        [r.to, r.from],
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

      // conditions, then requirements, then availability in RFC 0002 §4.2's order. A guard is unknown at projection
      // until handlers can run it (M3b)
      const result = (x: { id: string; description: string; expr?: Expr }): ConditionResult => ({
        id: x.id,
        description: x.description,
        value: x.expr ? evaluate(x.expr, context) : 'unknown',
      })
      const conditions = (c.preconditions ?? []).map((x) => result(x as never))
      const authorization = c.authorization
        ? c.authorization.principal === 'authenticated' && !principal.authenticated
          ? false
          : all((c.authorization.conditions ?? []).map((x) => result(x as never).value))
        : undefined
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
          const unknown = (c.preconditions ?? []).filter(
            (_, i) => conditions[i]!.value === 'unknown',
          )
          const pathsOf = unknown.map((x) => ('expr' in x ? paths(x.expr) : []))
          if (pathsOf.every((p) => p.some((path) => path.startsWith('input.'))))
            return {
              status: 'needs-input',
              inputs: [...new Set(pathsOf.flat().filter((p) => p.startsWith('input.')))].toSorted(),
            }
          return { status: 'unknown', because: unknown.map((x) => x.id) }
        }
        return { status: 'available' }
      })()

      const claims: ClaimView[] = (manifest.claims ?? [])
        .filter(
          (k) =>
            k.subject === c.id &&
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
        revision: await digestOf({ ...base, resources: reads, guards: [] }),
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
    const revision = await digestOf({ ...base, resources: everyRead, guards: [] })

    // every offer, in canonical order, with nothing omitted. policies and budgets choose subsets in M3c
    const view = (): View => {
      const v: View = {
        revision,
        policy: 'exhaustive',
        offers,
        choiceSets,
        order: { by: 'canonical' },
        omitted: { offers: 0, choiceSets: 0, claims: 0, expand: [] },
      }
      if (request.seen !== undefined && request.seen !== revision) v.stale = true
      return v
    }
    return {
      revision,
      offers,
      choiceSets,
      view,
      // runtime-internal: it holds what a view omits, so it never goes on a wire (RFC 0002 §11). views do
      toJSON() {
        throw new TypeError('a projection is runtime-internal: serialize its view() instead')
      },
    }
  }

  return { manifest, project }
}
