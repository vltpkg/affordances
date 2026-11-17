import { COMPARISONS, type Expr, type Operand, type Path, type Scalar } from './schema.ts'

// RFC 0001 §3.1's evaluation: Kleene's strong three-valued logic over a context the application supplies
export type Truth = true | false | 'unknown'

type Obj = Record<string, unknown>
// what an evaluator is given: a value, or nothing, for each root. A reference's value is under its name
export type Context = {
  target?: Obj
  input?: Obj
  principal?: Obj
  references?: Record<string, Obj | undefined>
}

// a path is missing (not supplied: unknown), absent (supplied, and none), or a value (§3.1). An absent path whose key
// was there, holding null, says so, for the one reader that shows it (a summary renders null, RFC 0001 §3.2)
export type Resolved =
  | { kind: 'missing' }
  | { kind: 'absent'; null?: true }
  | { kind: 'value'; value: unknown }
const MISSING: Resolved = { kind: 'missing' }
const ABSENT: Resolved = { kind: 'absent' }
const NULL: Resolved = { kind: 'absent', null: true }

type Scope = { context: Context; item?: unknown }

const resolve = (path: Path, scope: Scope): Resolved => {
  const [root, ...rest] = path.split('.')
  // input and an array's elements are supplied whole: a key they don't have is absent
  const whole = root === 'input' || root === 'item'
  let value: unknown =
    root === 'item'
      ? scope.item
      : root === 'target' || root === 'input' || root === 'principal'
        ? scope.context[root]
        : // a reference's own entry only: never one Object.prototype has
          scope.context.references && Object.hasOwn(scope.context.references, root!)
          ? scope.context.references[root!]
          : undefined
  if (value === undefined) return MISSING
  for (const [n, key] of rest.entries()) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return ABSENT
    // a root's own attribute the application didn't supply is missing; a key deeper in a supplied value is absent
    // own keys only: an inherited one (constructor, toString) was never supplied
    if (!Object.hasOwn(value, key)) return n === 0 && !whole ? MISSING : ABSENT
    value = (value as Obj)[key]
  }
  return value === null ? NULL : value === undefined ? ABSENT : { kind: 'value', value }
}
// what a path names in a context, own keys only: missing, absent or a value (§3.1). item, inside a quantifier
export const resolvePath = (path: Path, context: Context, item?: unknown): Resolved =>
  resolve(path, { context, item })

const operand = (o: Operand, scope: Scope): Resolved => {
  if ('value' in o) return { kind: 'value', value: o.value }
  if ('path' in o) return resolve(o.path, scope)
  const r = resolve(o.count, scope)
  if (r.kind !== 'value') return r
  // count of something that isn't an array has no value
  return Array.isArray(r.value) ? { kind: 'value', value: r.value.length } : MISSING
}

const isScalar = (v: unknown): v is Scalar =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v)

// one comparison, with three values: a mismatch, or a number that isn't finite, is unknown, never false
export const compareValues = (op: string, a: unknown, b: unknown): Truth => {
  if (op === 'in') {
    if (!Array.isArray(b) || !isScalar(a)) return 'unknown'
    if (typeof a === 'number' && !Number.isFinite(a)) return 'unknown'
    return b.some((m) => m === a)
  }
  // a mismatch at run time is unknown, never false (§3.1); so is a number that isn't finite, which orders as nothing
  if (!isScalar(a) || !isScalar(b) || typeof a !== typeof b) return 'unknown'
  if (typeof a === 'number' && (!Number.isFinite(a) || !Number.isFinite(b as number)))
    return 'unknown'
  if (op === 'eq') return a === b
  if (op === 'ne') return a !== b
  if (typeof a !== 'number' && typeof a !== 'string') return 'unknown'
  // strings by UTF-16 code units, numbers numerically
  const order = a < (b as typeof a) ? -1 : a > (b as typeof a) ? 1 : 0
  return op === 'lt' ? order < 0 : op === 'le' ? order <= 0 : op === 'gt' ? order > 0 : order >= 0
}

// Kleene's strong all: false wins, then unknown
export const all = (values: Truth[]): Truth =>
  values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true
const any = (values: Truth[]): Truth =>
  values.includes(true) ? true : values.includes('unknown') ? 'unknown' : false
const not = (v: Truth): Truth => (v === 'unknown' ? v : !v)

const run = (e: Expr, scope: Scope): Truth => {
  if ('all' in e) return all(e.all.map((x) => run(x, scope)))
  if ('any' in e) return any(e.any.map((x) => run(x, scope)))
  if ('not' in e) return not(run(e.not, scope))
  if ('exists' in e) {
    const r = resolve(e.exists, scope)
    return r.kind === 'missing' ? 'unknown' : r.kind === 'value'
  }
  if ('some' in e || 'every' in e) {
    const q = 'some' in e ? e.some : e.every
    // of in the enclosing scope, where in the new one
    const r = resolve(q.of, scope)
    if (r.kind !== 'value' || !Array.isArray(r.value)) return 'unknown'
    const each = r.value.map((item) => run(q.where, { ...scope, item }))
    return 'some' in e ? any(each) : all(each)
  }
  const op = COMPARISONS.find((c) => c in e)!
  const [left, right] = (e as Record<string, [Operand, Operand]>)[op]!
  const [a, b] = [operand(left, scope), operand(right, scope)]
  // a comparison with no value has no truth value, as with SQL NULL
  if (a.kind !== 'value' || b.kind !== 'value') return 'unknown'
  return compareValues(op, a.value, b.value)
}

export const evaluate = (expr: Expr, context: Context): Truth => run(expr, { context })
