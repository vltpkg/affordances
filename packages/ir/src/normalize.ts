import { canonicalJson, compare } from './canonical.ts'
import type {
  Binding,
  CapabilityDefinition,
  CapabilityManifest,
  Claim,
  Condition,
  Evidence,
  Expr,
  JSONSchema,
  Operand,
  Provenance,
  Relation,
  ResourceDefinition,
} from './schema.ts'

// RFC 0001 §7.2's canonical form, as an object: canonicalJson(normalize(m)) is the manifest's canonical bytes.
// It expects a manifest that validates. Children are normalized before their parents are sorted, so the bytes
// that order a set are already canonical. normalize(normalize(m)) equals normalize(m)

// a set: sorted by its key, ties broken by the element's canonical bytes, exact duplicates removed (§7.2 step 4)
// each item's key and RFC 8785 text are computed once, then the items sorted on them
const set = <T>(items: T[], key: (item: T) => string[] = () => []): T[] => {
  const decorated = items
    .map((item) => ({ item, keys: key(item), text: canonicalJson(item) }))
    .toSorted((a, b) => {
      for (let i = 0; i < a.keys.length; i++) {
        const order = compare(a.keys[i]!, b.keys[i]!)
        if (order) return order
      }
      return compare(a.text, b.text)
    })
  return decorated.filter((d, i) => i === 0 || d.text !== decorated[i - 1]!.text).map((d) => d.item)
}

// optional arrays are dropped when empty (§7.2 step 5); effects is the exception, and its caller keeps it
const optional = <T>(items: T[] | undefined) => (items?.length ? items : undefined)

const schema = (s: JSONSchema | undefined): JSONSchema | undefined => {
  if (!s) return s
  // every embedded schema is 2020-12, so $schema says nothing (§7.2 step 6); the rest is left as written
  const { $schema: _, ...rest } = s
  return rest
}

const operand = (o: Operand): Operand =>
  'value' in o && Array.isArray(o.value) ? { value: set(o.value) } : o

const expr = (e: Expr): Expr => {
  if ('all' in e) return { all: set(e.all.map(expr)) }
  if ('any' in e) return { any: set(e.any.map(expr)) }
  if ('not' in e) return { not: expr(e.not) }
  if ('some' in e) return { some: { of: e.some.of, where: expr(e.some.where) } }
  if ('every' in e) return { every: { of: e.every.of, where: expr(e.every.where) } }
  if ('exists' in e) return e
  // a comparison's operands are a sequence: lt is ordered
  const [op, [a, b]] = Object.entries(e)[0] as [string, [Operand, Operand]]
  return { [op]: [operand(a), operand(b)] } as Expr
}

const condition = (c: Condition): Condition => ('expr' in c ? { ...c, expr: expr(c.expr) } : c)

// an empty extensions object says nothing, and is dropped like an empty array (§7.2 step 5)
const extensions = (e: Record<string, unknown> | undefined) =>
  e && Object.keys(e).length ? e : undefined

const evidence = (list: Evidence[] | undefined) => optional(list && set(list))
const provenance = (p: Provenance): Provenance => ({ ...p, evidence: evidence(p.evidence) })

export const normalize = (input: CapabilityManifest): CapabilityManifest => {
  const base = provenance(input.provenance)
  const baseBytes = canonicalJson(base)
  // a definition's own provenance, unless it's the manifest's (§7.2 step 5)
  const own = (p: Provenance | undefined) => {
    if (!p) return undefined
    const normal = provenance(p)
    return canonicalJson(normal) === baseBytes ? undefined : normal
  }
  // per-field provenance, unless it's the definition's own
  const fields = (record: Record<string, Provenance> | undefined, inherited: Provenance) => {
    if (!record) return undefined
    const inheritedBytes = canonicalJson(inherited)
    const kept = Object.entries(record)
      .map(([k, p]) => [k, provenance(p)] as const)
      .filter(([, p]) => canonicalJson(p) !== inheritedBytes)
    return kept.length ? Object.fromEntries(kept) : undefined
  }
  const attributed = <
    T extends { provenance?: Provenance; fieldProvenance?: Record<string, Provenance> },
  >(
    x: T,
  ): T => {
    const p = own(x.provenance)
    return {
      ...x,
      provenance: p,
      fieldProvenance: fields(x.fieldProvenance, p ?? base),
      extensions: extensions((x as { extensions?: Record<string, unknown> }).extensions),
    }
  }

  const resource = (r: ResourceDefinition): ResourceDefinition =>
    attributed({
      ...r,
      attributes: schema(r.attributes),
      contains: optional(r.contains && set(r.contains)),
    })

  const capability = (c: CapabilityDefinition): CapabilityDefinition => {
    // the kind is the claim: a query is safe and has no effects (§2.2, §7.2 step 2)
    const query = c.kind === 'query'
    return attributed({
      ...c,
      input: schema(c.input),
      output: schema(c.output),
      safe: query ? true : c.safe,
      references: optional(c.references && set(c.references, (r) => [r.name])),
      preconditions: optional(
        c.preconditions && set(c.preconditions.map(condition), (x) => [x.id]),
      ),
      authorization: c.authorization && {
        ...c.authorization,
        conditions: optional(
          c.authorization.conditions &&
            set(c.authorization.conditions.map(condition), (x) => [x.id]),
        ),
      },
      // absent effects are unknown and stay absent; [] is a declaration and stays (§4)
      effects: query
        ? []
        : c.effects &&
          set(
            c.effects.map((e) =>
              e.category === 'state' && e.establishes
                ? { ...e, establishes: expr(e.establishes) }
                : e.category === 'financial' && e.applies
                  ? { ...e, applies: expr(e.applies) }
                  : e,
            ),
          ),
    })
  }

  const relation = (r: Relation): Relation => {
    // alternativeTo is symmetric: the lesser end goes first, before relations are sorted (§7.2 step 3)
    const swap = r.type === 'alternativeTo' && compare(r.to, r.from) < 0
    return {
      ...r,
      from: swap ? r.to : r.from,
      to: swap ? r.from : r.to,
      provenance: own(r.provenance),
      extensions: extensions(r.extensions),
    }
  }

  const claim = (c: Claim): Claim => ({
    ...c,
    applies: c.applies && expr(c.applies),
    provenance: provenance(c.provenance),
    extensions: extensions(c.extensions),
  })

  return strip({
    ...input,
    extensions: extensions(input.extensions),
    provenance: base,
    principal: input.principal && {
      ...attributed(input.principal),
      attributes: schema(input.principal.attributes)!,
    },
    sources: set(input.sources, (s) => [s.id]),
    resources: set(input.resources.map(resource), (r) => [r.id]),
    capabilities: set(input.capabilities.map(capability), (c) => [c.id]),
    relations: optional(
      input.relations && set(input.relations.map(relation), (r) => [r.type, r.from, r.to]),
    ),
    claims: optional(input.claims && set(input.claims.map(claim), (c) => [c.id])),
    bindings: optional(
      input.bindings &&
        set(
          input.bindings.map((b) => ({ ...b, extensions: extensions(b.extensions) })),
          (b: Binding) => [b.capability, b.protocol, canonicalJson(b.address)],
        ),
    ),
  })
}

// the canonical form has no undefined members; spreading left some
const strip = <T>(value: T): T => JSON.parse(canonicalJson(value)) as T
