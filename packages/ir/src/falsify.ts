import type { Context } from './evaluate.ts'
import type { CapabilityManifest, Expr, Id, Operand, Scalar } from './schema.ts'

// rule 5's manifest half (RFC 0001 §8.2, §12.2): for a declarative condition, a context that makes it false. The
// conformance kit (M3) arranges that context, calls the capability and expects the declared refusal. Undefined
// when the expression can't be made false (a contradiction such as `any [eq x 1, ne x 1]`)

type Assignment = [path: string, value: unknown]
const COMPARISONS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in'] as const

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

const holds = (op: string, a: unknown, b: unknown): boolean => {
  if (op === 'in') return Array.isArray(b) && b.some((m) => m === a)
  if (typeof a !== typeof b) return false
  if (op === 'eq') return a === b
  if (op === 'ne') return a !== b
  const order = (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0
  return op === 'lt' ? order < 0 : op === 'le' ? order <= 0 : op === 'gt' ? order > 0 : order >= 0
}

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

// the context that makes expr false
export const falsifying = (expr: Expr): Context | undefined => {
  const assignments = witness(expr, false)
  return assignments && contextOf(assignments)
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
}
// a count's witness is an array of empty placeholders. Fitted to the schema the root is declared by, each becomes a
// value of the item's type, so an application's own resolver accepts the state the kit arranges (code review 7)
type Schemaish = { type?: unknown; items?: unknown; properties?: Record<string, unknown> }
const placeholder = (schema: Schemaish | undefined): unknown => {
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type
  if (type === 'string') return ''
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'null') return null
  if (type === 'array') return []
  return {}
}
const fit = (value: unknown, schema: unknown): unknown => {
  const s = (schema ?? {}) as Schemaish
  if (Array.isArray(value)) {
    const items = s.items as Schemaish | undefined
    return value.map((v) =>
      v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0
        ? placeholder(items)
        : fit(v, items),
    )
  }
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fit(v, s.properties?.[k])]))
  return value
}
export const fitContext = (
  m: CapabilityManifest,
  c: CapabilityManifest['capabilities'][number],
  context?: Context,
) => {
  if (!context) return context
  const resource = (id?: string) => m.resources.find((r) => r.id === id)?.attributes
  const out: Context = {}
  if (context.target)
    out.target = fit(context.target, resource(c.target)) as Record<string, unknown>
  if (context.principal)
    out.principal = fit(context.principal, m.principal?.attributes) as Record<string, unknown>
  if (context.input) out.input = fit(context.input, c.input) as Record<string, unknown>
  if (context.references)
    out.references = Object.fromEntries(
      Object.entries(context.references).map(([name, v]) => [
        name,
        fit(v, resource(c.references?.find((r) => r.name === name)?.resource)) as Record<
          string,
          unknown
        >,
      ]),
    )
  return out
}

export const conformanceCases = (m: CapabilityManifest): ConformanceCase[] =>
  m.capabilities.flatMap((c) => {
    const declarative = [
      ...(c.preconditions ?? []),
      ...(c.authorization?.conditions ?? []),
    ].flatMap((x) => ('expr' in x ? [{ id: x.id, expr: x.expr }] : []))
    return declarative.map((p) => {
      const alone = merge([
        witness(p.expr, false),
        ...declarative.filter((q) => q.id !== p.id).map((q) => witness(q.expr, true)),
      ])
      if (alone)
        return {
          capability: c.id,
          condition: p.id,
          context: fitContext(m, c, contextOf(alone)),
          isolated: true,
        }
      return {
        capability: c.id,
        condition: p.id,
        context: fitContext(m, c, falsifying(p.expr)),
        isolated: false,
      }
    })
  })
