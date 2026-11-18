import { canonicalJson } from './canonical.ts'
import { compareValues, evaluate, type Context } from './evaluate.ts'
import {
  COMPARISONS,
  type CapabilityManifest,
  type Expr,
  type Id,
  type Operand,
  type Scalar,
} from './schema.ts'

// rule 5's manifest half (RFC 0001 §8.2, §12.2): for a declarative condition, a context that makes it false. The
// conformance kit (M3) arranges that context, calls the capability and expects the declared refusal. Undefined
// when the expression can't be made false (a contradiction such as `any [eq x 1, ne x 1]`)

type Assignment = [path: string, value: unknown]

// two assignments to one path must agree, and neither may be inside the other
const merge = (parts: (Assignment[] | undefined)[]): Assignment[] | undefined => {
  const out: Assignment[] = []
  for (const part of parts) {
    if (!part) return undefined
    for (const [path, value] of part) {
      const clash = out.find(
        ([p, v]) =>
          (p === path && JSON.stringify(v) !== JSON.stringify(value)) ||
          p.startsWith(`${path}.`) ||
          path.startsWith(`${p}.`),
      )
      if (clash) return undefined
      if (!out.some(([p]) => p === path)) out.push([path, value])
    }
  }
  return out
}

// a candidate witness holds when the evaluator itself says true: one comparison semantics, so null never orders and a
// mismatch never counts (it did here: null le null held, though the evaluator says unknown)
const holds = (op: string, a: unknown, b: unknown): boolean => compareValues(op, a, b) === true

// values to try for an operand compared with v: v itself, and its neighbours either side
const around = (v: Scalar | Scalar[]): unknown[] => {
  if (typeof v === 'number') return [v, v - 1, v + 1]
  if (typeof v === 'string') return v ? [v, '', `${v}~`] : [v, '~']
  if (typeof v === 'boolean') return [v, !v]
  // an in's list: one of its members, and a value of the same type that isn't one
  if (Array.isArray(v)) {
    const [first] = v
    const other =
      typeof first === 'number'
        ? Math.max(...(v as number[])) + 1
        : typeof first === 'boolean'
          ? !first
          : `${v.join('')}~`
    return [first, other]
  }
  return []
}

// one side's value: a path takes it, a count takes an array of that length
const put = (o: Operand, value: unknown): Assignment[] | undefined => {
  if ('value' in o) return []
  if ('path' in o) return [[o.path, value]]
  if (!Number.isInteger(value) || (value as number) < 0) return undefined
  return [[o.count, Array.from({ length: value as number }, () => ({}))]]
}

const comparison = (
  op: string,
  left: Operand,
  right: Operand,
  want: boolean,
): Assignment[] | undefined => {
  if ('value' in left && 'value' in right)
    return holds(op, left.value, right.value) === want ? [] : undefined
  // one side a literal: try values for the other
  if ('value' in left || 'value' in right) {
    const literal = ('value' in left ? left.value : (right as { value: Scalar | Scalar[] }).value)!
    const free = 'value' in left ? right : left
    // in with the list in a path: the list is what gets chosen
    if (op === 'in' && 'value' in left) return put(free, want ? [literal] : [])
    const candidates =
      'count' in free
        ? around(literal).filter((n) => Number.isInteger(n) && (n as number) >= 0)
        : around(literal)
    for (const x of candidates) {
      const ok = 'value' in left ? holds(op, literal, x) : holds(op, x, literal)
      if (ok === want) return put(free, x)
    }
    return undefined
  }
  // two paths: a pair of values that gives the wanted answer
  const pairs: [unknown, unknown][] =
    op === 'in'
      ? want
        ? [['a', ['a']]]
        : [['a', []]]
      : [
          ['a', 'a'],
          ['a', 'b'],
          [0, 1],
          [1, 0],
          [1, 1],
        ]
  for (const [a, b] of pairs) {
    if ('count' in left || 'count' in right) {
      if (typeof a !== 'number' || typeof b !== 'number') continue
    }
    if (holds(op, a, b) === want) return merge([put(left, a), put(right, b)])
  }
  return undefined
}

// a set of assignments that makes e evaluate to want
const witness = (e: Expr, want: boolean): Assignment[] | undefined => {
  if ('all' in e)
    return want
      ? merge(e.all.map((x) => witness(x, true)))
      : e.all.map((x) => witness(x, false)).find(Boolean)
  if ('any' in e)
    return want
      ? e.any.map((x) => witness(x, true)).find(Boolean)
      : merge(e.any.map((x) => witness(x, false)))
  if ('not' in e) return witness(e.not, !want)
  // exists: a value, or null, which is absent
  if ('exists' in e) return [[e.exists, want ? 'x' : null]]
  if ('some' in e || 'every' in e) {
    const some = 'some' in e
    const q = some ? e.some : e.every
    // some false and every true hold over an empty array; the other two need one element that decides
    if (some !== want) return [[q.of, []]]
    const inner = witness(q.where, want)
    if (!inner) return undefined
    const element: Record<string, unknown> = {}
    let bare: unknown = element
    const outer: Assignment[] = []
    for (const [path, value] of inner) {
      if (path === 'item') bare = value
      else if (path.startsWith('item.')) set(element, path.slice('item.'.length), value)
      else outer.push([path, value])
    }
    return merge([outer, [[q.of, [bare]]]])
  }
  const op = COMPARISONS.find((c) => c in e)!
  const [left, right] = (e as Record<string, [Operand, Operand]>)[op]!
  return comparison(op, left, right, want)
}

const set = (target: Record<string, unknown>, path: string, value: unknown) => {
  const keys = path.split('.')
  let node = target
  for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Record<string, unknown>
  node[keys.at(-1)!] = value
}

// assignments as a context, by root; references under their names
const contextOf = (assignments: Assignment[]): Context => {
  const context: Context & Record<string, unknown> = {}
  for (const [path, value] of assignments) {
    const [root, ...rest] = path.split('.')
    const bucket =
      root === 'target' || root === 'input' || root === 'principal'
        ? ((context[root] ??= {}) as Record<string, unknown>)
        : (((context.references ??= {})[root!] ??= {}) as Record<string, unknown>)
    set(bucket, rest.join('.'), value)
  }
  return context
}

// a complete search for a state that makes expr false (review's close-out finding). The witness above is fast and
// reads naturally, but misses some expressions (a disjunction over one path with overlapping literals, such as
// any[in(s, [x, z]), eq(s, x)], false at s = y). Over this condition language the candidates are finite:
// - each scalar path takes the expression's literals, a step either side of each, one fresh value, null, or nothing;
// - each array (a count or a quantifier's of) takes lists of 0, 1 and 2 items built the same way, and the lengths
//   its counts name, one either side.
// Kleene evaluation is monotone in information: a partial state that's already true stays true however it's
// extended, so that branch is cut. none: no state of this language makes it false. gaveUp: the node budget ran out
export type Falsified = { context: Context } | { none: true } | { gaveUp: true }
const MISSING = Symbol('missing')
// capped: the candidates are a bounded part of the slot's space, so exhausting them proves nothing
type Slot = { path: string; candidates: unknown[]; capped?: true }
// the most items, and lists of them, an array slot takes; past these it's capped
const MAX_ITEMS = 512
const MAX_LISTS = 8192

// an operand's literals, an in's list flattened
const flat = (o: Operand): Scalar[] =>
  'value' in o ? (Array.isArray(o.value) ? o.value : [o.value]) : []
// lists of none, one and two of the items, and the lengths a count names
const listsOf = (items: unknown[], extra: number[] = []): { lists: unknown[]; capped: boolean } => {
  const out: unknown[] = [[]]
  for (const a of items) out.push([a])
  // pairs, as many as fit: two items can each satisfy a different part of a where
  let capped = false
  pairs: for (const a of items)
    for (const b of items) {
      if (out.length >= MAX_LISTS) {
        capped = true
        break pairs
      }
      out.push([a, b])
    }
  // the lengths a count names, one either side, of one item repeated
  for (const n of extra)
    for (const len of [n - 1, n, n + 1])
      if (len > 2 && len <= 12) out.push(Array.from({ length: len }, () => items[0] ?? {}))
  return { lists: out, capped }
}
// an item for a quantifier: every combination of its where's item.* fields, each one of its candidates or absent, so
// a where over two fields of one item (review of the kit rework) is reachable
const itemsFor = (wheres: Expr[], pools: Pools): { items: unknown[]; capped: boolean } => {
  const inner = slotsOf({ all: wheres.length ? wheres : [{ exists: 'item' }] }, true, pools)
  const fields = inner.filter((s) => s.path.startsWith('item.') && !s.path.slice(5).includes('.'))
  const bare = inner.find((s) => s.path === 'item')
  const capped = inner.some((s) => s.capped)
  if (bare && !fields.length) return { items: bare.candidates.filter((c) => c !== MISSING), capped }
  let items: Record<string, unknown>[] = [{}]
  for (const f of fields) {
    const next: Record<string, unknown>[] = []
    for (const item of items)
      for (const c of f.candidates)
        next.push(c === MISSING ? item : { ...item, [f.path.slice(5)]: c })
    if (next.length > MAX_ITEMS) return { items: next.slice(0, MAX_ITEMS), capped: true }
    items = next
  }
  return { items, capped }
}

// inItem: the slots of a quantifier's where, whose item.* paths are the item's own fields
const isItem = (path: string) => /^item(\.|$)/.test(path)
// the literals each path is compared with, and the paths compared with each other
type Pools = { literals: Map<string, Scalar[]>; peers: Map<string, Set<string>> }
// pools: the whole expression's, for a where's slots, so an item field compared with an outer path takes that path's
// literals too (review of the kit rework: eq(item.k, target.s) with target.s in [x, z])
const slotsOf = (expr: Expr, inItem = false, pools?: Pools): Slot[] => {
  // per path, the literals it's compared with; paths compared with each other share theirs
  const literals = new Map<string, Scalar[]>()
  const peers = new Map<string, Set<string>>()
  const lists = new Set<string>() // paths an in reads as its list
  const arrays = new Map<string, Expr[]>() // array paths, with the where of each quantifier over them
  const counts = new Map<string, number[]>() // array paths counted, with the numbers they're counted against
  const scalar = (path: string, values: Scalar[] = []) =>
    literals.set(path, [...(literals.get(path) ?? []), ...values])
  const peer = (a: string, b: string) => {
    peers.set(a, (peers.get(a) ?? new Set()).add(b))
    peers.set(b, (peers.get(b) ?? new Set()).add(a))
  }
  const walk = (e: Expr) => {
    if ('all' in e) return e.all.forEach(walk)
    if ('any' in e) return e.any.forEach(walk)
    if ('not' in e) return walk(e.not)
    if ('exists' in e) return void scalar(e.exists)
    if ('some' in e || 'every' in e) {
      const q = 'some' in e ? e.some : e.every
      arrays.set(q.of, [...(arrays.get(q.of) ?? []), q.where])
      // a where reads paths outside the item too
      return walk(q.where)
    }
    const op = COMPARISONS.find((c) => c in e)!
    const [left, right] = (e as Record<string, [Operand, Operand]>)[op]!
    for (const [o, other] of [
      [left, right],
      [right, left],
    ] as const) {
      if ('count' in o) {
        if (!arrays.has(o.count)) arrays.set(o.count, [])
        counts.set(o.count, [
          ...(counts.get(o.count) ?? []),
          ...flat(other).filter((v): v is number => typeof v === 'number'),
        ])
      } else if ('path' in o) {
        // the right of an in is a list
        if (op === 'in' && o === right) lists.add(o.path)
        scalar(o.path, flat(other))
        if ('path' in other) peer(o.path, other.path)
      }
    }
  }
  walk(expr)
  // a path's candidates: its literals and its peers', a step either side of each, a fresh value of each kind among
  // them (or a string when there are none), and null
  const own = pools ?? { literals, peers }
  const candidatesOf = (path: string): unknown[] => {
    const seen = new Set([path])
    const queue = [path]
    const lits: Scalar[] = []
    while (queue.length) {
      const at = queue.pop()!
      lits.push(...(own.literals.get(at) ?? []))
      for (const n of own.peers.get(at) ?? [])
        if (!seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
    }
    const pool = new Map<string, unknown>()
    const add = (v: unknown) => pool.set(canonicalJson(v), v)
    for (const v of lits) for (const w of around(v)) add(w)
    const kinds = new Set(lits.map((v) => (v === null ? 'null' : typeof v)))
    // two fresh values of a kind, so two paths compared with each other can be told apart (ne between them holds)
    const fresh: unknown[] = []
    if (kinds.has('number')) fresh.push(7919, 7920)
    if (kinds.has('string') || !kinds.size) fresh.push('~fresh', '~fresh2')
    if (kinds.has('boolean')) fresh.push(true, false)
    for (const v of fresh) add(v)
    add(null)
    return [...pool.values()]
  }
  const slots: Slot[] = []
  for (const path of literals.keys()) {
    if ((isItem(path) && !inItem) || arrays.has(path)) continue
    const values = candidatesOf(path)
    if (!lists.has(path)) {
      slots.push({ path, candidates: [...values, MISSING] })
      continue
    }
    const { lists: of, capped } = listsOf(values)
    slots.push({ path, candidates: [...of, MISSING], ...(capped && { capped: true as const }) })
  }
  for (const [path, wheres] of arrays) {
    if (isItem(path) && !inItem) continue
    const { items, capped } = itemsFor(wheres, own)
    const { lists: of, capped: some } = listsOf(items, counts.get(path))
    slots.push({
      path,
      candidates: [...of, MISSING],
      ...((capped || some) && { capped: true as const }),
    })
  }
  return slots
}

// what making expr false asks, as constraints that each must come out a given way: an any false is every child
// false, an all true is every child true, a not flips. Constraints that share no path are independent, so each group
// is searched alone, and the space is their sum, not their product
const constraintsOf = (e: Expr, want: boolean): [Expr, boolean][] => {
  if ('any' in e && !want) return e.any.flatMap((c) => constraintsOf(c, false))
  if ('all' in e && want) return e.all.flatMap((c) => constraintsOf(c, true))
  if ('not' in e) return constraintsOf(e.not, !want)
  return [[e, want]]
}
const groupsOf = (constraints: [Expr, boolean][]): [Expr, boolean][][] => {
  const paths = constraints.map(([e]) => new Set(slotsOf(e).map((s) => s.path)))
  const group = constraints.map((_, i) => i)
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)))
  for (let i = 0; i < constraints.length; i++)
    for (let j = i + 1; j < constraints.length; j++)
      if ([...paths[i]!].some((x) => paths[j]!.has(x))) group[find(i)] = find(j)
  const out = new Map<number, [Expr, boolean][]>()
  constraints.forEach((c, i) => out.set(find(i), [...(out.get(find(i)) ?? []), c]))
  return [...out.values()]
}

export const searchFalsifying = (expr: Expr, budget = 200_000): Falsified => {
  const groups = groupsOf(constraintsOf(expr, false))
  if (groups.length <= 1) return searchWhole(expr, budget)
  // each group as one expression whose falsity is exactly its constraints holding
  const contexts: Context[] = []
  for (const g of groups) {
    const part: Expr = { any: g.map(([e, want]) => (want ? { not: e } : e)) }
    const found = searchWhole(part, budget)
    if (!('context' in found)) return found
    contexts.push(found.context)
  }
  // groups share no path, so their states merge without conflict
  const merged: Context = {}
  for (const c of contexts)
    for (const [root, value] of Object.entries(c) as [keyof Context, Record<string, unknown>][])
      if (root === 'references')
        for (const [name, attrs] of Object.entries(value))
          (merged.references ??= {})[name] = {
            ...merged.references?.[name],
            ...(attrs as Record<string, unknown>),
          }
      else
        (merged as Record<string, Record<string, unknown>>)[root] = {
          ...(merged as Record<string, Record<string, unknown>>)[root],
          ...value,
        }
  return evaluate(expr, merged) === false ? { context: merged } : searchWhole(expr, budget)
}

const searchWhole = (expr: Expr, budget: number): Falsified => {
  const slots = slotsOf(expr).filter((s) => !isItem(s.path))
  let nodes = 0
  const chosen: Assignment[] = []
  const go = (i: number): Context | undefined | 'gaveUp' => {
    if (++nodes > budget) return 'gaveUp'
    const context = contextOf(chosen)
    const value = evaluate(expr, context)
    // false already, with what's left unsupplied: that's a state
    if (value === false) return context
    // true can't become false by supplying more (Kleene is monotone in information)
    if (value === true || i === slots.length) return
    for (const c of slots[i]!.candidates) {
      if (c !== MISSING) chosen.push([slots[i]!.path, c])
      const found = go(i + 1)
      if (c !== MISSING) chosen.pop()
      if (found) return found
    }
  }
  const found = go(0)
  if (found === 'gaveUp') return { gaveUp: true }
  if (found) return { context: found }
  // exhausting a capped slot's candidates isn't exhausting its space
  return slots.some((s) => s.capped) ? { gaveUp: true } : { none: true }
}

// the context that makes expr false
export const falsifying = (expr: Expr): Context | undefined => {
  const assignments = witness(expr, false)
  if (assignments) return contextOf(assignments)
  // the witness missed it: search the whole bounded space
  const searched = searchFalsifying(expr)
  return 'context' in searched ? searched.context : undefined
}

// every declarative precondition and authorization condition in a manifest, each with a context in which it alone
// is false: every other declarative condition of the capability is true there. Under rule 5 unknown refuses too, so
// a context that left the others unknown would get a refusal from a binding that never enforces the one under test.
// When no such context exists (the condition implies another), the case still makes it false and says isolated:
// false, so a kit knows the refusal can't be attributed to it. Guards aren't cases: for a declarative case, the kit
// forces the capability's guards to pass (RFC 0002 R5)
export type ConformanceCase = {
  capability: Id
  condition: string
  context: Context | undefined
  isolated: boolean
  // why the case can't be run as it should, when its context, fitted to the declared schemas, no longer falsifies it:
  // the kit fails it with this, never a pass on the wrong refusal (boundary review #3)
  reason?: string
}
// a count's witness is an array of empty placeholders. Fitted to the schema the root is declared by, each becomes a
// value of the item's type, so an application's own resolver accepts the state the kit arranges (code review 7)
type Schemaish = {
  type?: unknown
  items?: unknown
  properties?: Record<string, unknown>
  required?: unknown
  enum?: unknown
  const?: unknown
}
const placeholder = (schema: Schemaish | undefined): unknown => {
  // a value the schema allows, so a conformant resolver accepts it (review of the code-review fixes, b)
  if (schema?.const !== undefined) return schema.const
  if (Array.isArray(schema?.enum) && schema.enum.length) return schema.enum[0]
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type
  if (type === 'string') return ''
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'null') return null
  if (type === 'array') return []
  // an object, with each required property filled from its own schema
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : []
  return Object.fromEntries(
    required.map((k) => [k, placeholder(schema?.properties?.[k] as Schemaish | undefined)]),
  )
}
const kindOf = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v
const fits = (kind: string, type: string) =>
  kind === type ||
  (type === 'integer' && kind === 'number') ||
  (type === 'number' && kind === 'number')
// the declared type a leaf the search gave another type must take, or undefined when its value fits: a search's fresh
// value only had to be some other value, and a resolver's attributes must fit their schema or the instance loads as
// unknown (review of bb61e4e2). null stays, since it's what makes exists false
const retype = (value: unknown, s: Schemaish): string | undefined => {
  const declared = Array.isArray(s.type) ? (s.type as string[]) : s.type ? [s.type as string] : []
  const kind = kindOf(value)
  if (!declared.length || kind === 'null' || declared.some((d) => fits(kind, d))) return undefined
  return declared[0]
}
// a coercion: for each declared type, each distinct value the search gave there, to a value of that type
type Coercion = (value: unknown, type: string, s: Schemaish) => unknown
const fit = (raw: unknown, schema: unknown, coerce: Coercion): unknown => {
  const s = (schema ?? {}) as Schemaish
  const type = retype(raw, s)
  const value = type === undefined ? raw : coerce(raw, type, s)
  if (Array.isArray(value)) {
    const items = s.items as Schemaish | undefined
    return value.map((v) =>
      v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0
        ? placeholder(items)
        : fit(v, items, coerce),
    )
  }
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fit(v, s.properties?.[k], coerce)]),
    )
  return value
}

// every scalar in a context, so a coerced value is never one that's already there
const scalars = (value: unknown, out = new Set<unknown>()): Set<unknown> => {
  if (Array.isArray(value)) for (const v of value) scalars(v, out)
  else if (value !== null && typeof value === 'object')
    for (const v of Object.values(value)) scalars(v, out)
  else out.add(value)
  return out
}
// the search's own order between values, where it has one: a number before a string, then each by its own order
const searchOrder = (a: unknown, b: unknown) => {
  const [ka, kb] = [kindOf(a), kindOf(b)]
  if (ka !== kb) return ka < kb ? -1 : 1
  return compareValues('lt', a, b) === true ? -1 : compareValues('gt', a, b) === true ? 1 : 0
}
// distinct values stay distinct, in the order the search gave them, so two paths it told apart, or ordered, still are
// (boundary review #3): numbers from 7919 up and strings from '~fresh-0000' up, past any value the context holds, and
// booleans false then true. More distinct values than a boolean holds repeat, and the re-check says so
const coercionFor = (
  raw: Record<string, unknown>,
  collect: (coerce: Coercion) => void,
): Coercion => {
  const wanted = new Map<string, unknown[]>()
  collect((value, type) => {
    const seen = wanted.get(type) ?? []
    if (!seen.some((v) => canonicalJson(v) === canonicalJson(value))) seen.push(value)
    wanted.set(type, seen)
    return value
  })
  const used = scalars(raw)
  const assigned = new Map<string, Map<string, unknown>>()
  for (const [type, values] of wanted) {
    let n = 7919
    let i = 0
    const next = () => {
      if (type === 'number' || type === 'integer') {
        while (used.has(n)) n++
        return n++
      }
      if (type === 'boolean') return i++ % 2 === 1
      for (;;) {
        const s = `~fresh-${String(i++).padStart(4, '0')}`
        if (!used.has(s)) return s
      }
    }
    assigned.set(
      type,
      new Map(
        values.toSorted(searchOrder).map((v) => [canonicalJson(v), next()] as [string, unknown]),
      ),
    )
  }
  return (value, type, s) =>
    type === 'number' || type === 'integer' || type === 'string' || type === 'boolean'
      ? assigned.get(type)!.get(canonicalJson(value))
      : placeholder(s)
}
export const fitContext = (
  m: CapabilityManifest,
  c: CapabilityManifest['capabilities'][number],
  context?: Context,
) => {
  if (!context) return context
  const resource = (id?: string) => m.resources.find((r) => r.id === id)?.attributes
  // one pass to learn every value that needs a type, then one to give each its own, so the coercion is the context's
  const fitAll = (coerce: Coercion) => {
    const out: Context = {}
    if (context.target)
      out.target = fit(context.target, resource(c.target), coerce) as Record<string, unknown>
    if (context.principal)
      out.principal = fit(context.principal, m.principal?.attributes, coerce) as Record<
        string,
        unknown
      >
    if (context.input) out.input = fit(context.input, c.input, coerce) as Record<string, unknown>
    if (context.references)
      out.references = Object.fromEntries(
        Object.entries(context.references).map(([name, v]) => [
          name,
          fit(v, resource(c.references?.find((r) => r.name === name)?.resource), coerce) as Record<
            string,
            unknown
          >,
        ]),
      )
    return out
  }
  return fitAll(coercionFor(context as Record<string, unknown>, fitAll))
}

export const conformanceCases = (m: CapabilityManifest): ConformanceCase[] =>
  m.capabilities.flatMap((c) => {
    const declarative = [
      ...(c.preconditions ?? []),
      ...(c.authorization?.conditions ?? []),
    ].flatMap((x) => ('expr' in x ? [{ id: x.id, expr: x.expr }] : []))
    return declarative.map((p): ConformanceCase => {
      const others = declarative.filter((q) => q.id !== p.id).map((q) => q.expr)
      // an isolated case must make p false and every other condition true: exactly what makes this false
      const isolating: Expr = others.length ? { any: [p.expr, { not: { all: others } }] } : p.expr
      // the case, fitted to the declared schemas, re-checked against what it must falsify
      const fitted = (raw: Context | undefined, isolated: boolean): ConformanceCase => {
        const context = fitContext(m, c, raw)
        const base = { capability: c.id, condition: p.id, context, isolated }
        if (!context || evaluate(isolated ? isolating : p.expr, context) === false) return base
        return {
          ...base,
          reason: `fitting the falsifying state to the declared schemas makes ${p.id} ${isolated && others.length ? 'or another condition ' : ''}hold again, so no conformant state isolates it`,
        }
      }
      const alone = merge([
        witness(p.expr, false),
        ...declarative.filter((q) => q.id !== p.id).map((q) => witness(q.expr, true)),
      ])
      const merged = alone ? fitted(contextOf(alone), true) : undefined
      if (merged && !merged.reason) return merged
      // the witnesses don't combine, or fitting undid them: search for a state where p alone is false, every other
      // condition true
      const searched = searchFalsifying(isolating)
      const found = 'context' in searched ? fitted(searched.context, true) : undefined
      if (found && !found.reason) return found
      const lone = fitted(falsifying(p.expr), false)
      // what failed first is what's said, when nothing fits
      return lone.reason ? (merged ?? found ?? lone) : lone
    })
  })
