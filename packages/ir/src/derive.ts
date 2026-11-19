import { canonicalJson, compare } from './canonical.ts'
import { compareValues } from './evaluate.ts'
import {
  COMPARISONS,
  type CapabilityManifest,
  type Expr,
  type Id,
  type JSONPointer,
  type Operand,
  type Scalar,
} from './schema.ts'

// RFC 0001 §5.5's derived edges: computed from the definitions, never stored. Each says what it came from, as
// pointers into the manifest, and has basis inferred. They're statements about the manifest, not the world
export type DerivedEdge = {
  relation: 'supports' | 'produces' | 'enables' | 'prerequisite'
  from: Id
  to: Id
  basis: 'inferred'
  via: JSONPointer[]
}

// an atom: a comparison or exists whose paths and counts are all target paths, with literal values (§5.5)
type Atom = Expr
const isTarget = (path: string) => path.startsWith('target.')
const operandOk = (o: Operand) =>
  'value' in o || ('path' in o ? isTarget(o.path) : isTarget(o.count))
const atoms = (e: Expr): Atom[] | undefined => {
  if ('all' in e) {
    const parts = e.all.map(atoms)
    return parts.every(Boolean) ? (parts.flat() as Atom[]) : undefined
  }
  if ('exists' in e) return isTarget(e.exists) ? [e] : undefined
  const op = COMPARISONS.find((c) => c in e)
  if (!op) return undefined // any, not, a quantifier: never an atom
  const pair = (e as Record<string, [Operand, Operand]>)[op]!
  return pair.every(operandOk) ? [e] : undefined
}

// what an operand reads, as a key: 'path:target.count', 'count:target.items'
const keyOf = (o: Operand) =>
  'path' in o ? `path:${o.path}` : 'count' in o ? `count:${o.count}` : undefined

// a value an atom of E fixes: eq between a key and a literal
const fixed = (e: Atom): [string, Scalar | Scalar[]] | undefined => {
  if (!('eq' in e)) return
  const [a, b] = e.eq
  if (keyOf(a) && 'value' in b) return [keyOf(a)!, b.value]
  if (keyOf(b) && 'value' in a) return [keyOf(b)!, a.value]
}

// does P's atom hold when the key it reads has the value v
const holds = (p: Atom, key: string, v: Scalar | Scalar[]): boolean => {
  if ('exists' in p) return `path:${p.exists}` === key && v !== null
  const op = COMPARISONS.find((c) => c in p)!
  const [a, b] = (p as Record<string, [Operand, Operand]>)[op]!
  const side =
    keyOf(a) === key && 'value' in b
      ? 'left'
      : keyOf(b) === key && 'value' in a
        ? 'right'
        : undefined
  if (!side) return false
  const [x, y] =
    side === 'left'
      ? [v, (b as { value: Scalar | Scalar[] }).value]
      : [(a as { value: Scalar | Scalar[] }).value, v]
  // a null literal decides nothing here: an atom with null is no constraint to derive from
  if (op !== 'in' && (x === null || y === null)) return false
  return compareValues(op, x, y) === true
}

// E satisfies P: every atom of P is matched by an atom of E, identical to it or an eq that makes it true (§5.5)
export const satisfies = (establishes: Expr, precondition: Expr): boolean => {
  const [es, ps] = [atoms(establishes), atoms(precondition)]
  if (!es || !ps) return false
  const identical = new Set(es.map(canonicalJson))
  const values = es.map(fixed).filter((f) => f !== undefined)
  return ps.every(
    (p) => identical.has(canonicalJson(p)) || values.some(([key, v]) => holds(p, key, v)),
  )
}

const at = (i: number) => `/capabilities/${i}`

export const derive = (m: CapabilityManifest): DerivedEdge[] => {
  const edges: DerivedEdge[] = []
  const add = (relation: DerivedEdge['relation'], from: Id, to: Id, via: JSONPointer[]) =>
    edges.push({ relation, from, to, basis: 'inferred', via })

  m.capabilities.forEach((c, i) => {
    if (c.target) add('supports', c.target, c.id, [`${at(i)}/target`])
    c.references?.forEach((r, j) =>
      add('supports', r.resource, c.id, [`${at(i)}/references/${j}/resource`]),
    )
    c.effects?.forEach((e, k) => {
      if (e.category === 'state' && e.change === 'create')
        add('produces', c.id, e.resource, [`${at(i)}/effects/${k}`])
    })
  })

  // every declarative precondition, and every effect that establishes something on its own target
  const establishing = m.capabilities.flatMap((b, i) =>
    (b.effects ?? []).flatMap((e, k) =>
      e.category === 'state' && e.establishes && e.resource === b.target
        ? [{ b, resource: e.resource, establishes: e.establishes, via: `${at(i)}/effects/${k}` }]
        : [],
    ),
  )
  m.capabilities.forEach((a, i) => {
    a.preconditions?.forEach((p, j) => {
      if (!('expr' in p) || !a.target) return
      const by = establishing.filter(
        (x) => x.resource === a.target && satisfies(x.establishes, p.expr),
      )
      const via = `${at(i)}/preconditions/${j}`
      for (const x of by) if (x.b.id !== a.id) add('enables', x.b.id, a.id, [x.via, via])
      // only one capability is declared to establish what A needs
      const others = new Set(by.map((x) => x.b.id))
      if (others.size === 1) {
        const [only] = by
        if (only!.b.id !== a.id) add('prerequisite', only!.b.id, a.id, [only!.via, via])
      }
    })
    // enables by creation: B creates the resource A targets
    m.capabilities.forEach((b, bi) =>
      b.effects?.forEach((e, k) => {
        if (
          b.id !== a.id &&
          e.category === 'state' &&
          e.change === 'create' &&
          e.resource === a.target
        )
          add('enables', b.id, a.id, [`${at(bi)}/effects/${k}`, `${at(i)}/target`])
      }),
    )
  })

  // one edge per relation and pair, with every reason; in a stable order
  const merged = new Map<string, DerivedEdge>()
  for (const e of edges) {
    const key = `${e.relation} ${e.from} ${e.to}`
    const seen = merged.get(key)
    if (seen) seen.via = [...new Set([...seen.via, ...e.via])].toSorted(compare)
    else merged.set(key, { ...e, via: e.via.toSorted(compare) })
  }
  return [...merged.values()].toSorted(
    (x, y) => compare(x.relation, y.relation) || compare(x.from, y.from) || compare(x.to, y.to),
  )
}
