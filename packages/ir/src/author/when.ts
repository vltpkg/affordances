import type { Expr, Operand, Scalar } from '../schema.ts'
import type { Rebase } from './paths.ts'

// the paths an expression reads, carried in its type so defineCapability can check them against the schemas
// (RFC 0001 §12.1). Type-only: nothing at run time has this key
declare const PATHS: unique symbol

// an expression, before it's a condition: say what it checks with `.because(description)`
export type When<P extends string = string> = {
  readonly expr: Expr
  readonly [PATHS]?: P
  because(description: string): Declared<P>
}

// a declarative condition, as defineCapability's preconditions take it
export type Declared<P extends string = string> = {
  readonly kind: 'expr'
  readonly expr: Expr
  readonly description: string
  readonly [PATHS]?: P
}

// an opaque condition: only its implementation, bound with defineAction's `guards`, can check it
export type Guard = { readonly kind: 'guard'; readonly description: string }

export type PathsIn<T> = T extends { readonly [PATHS]?: infer P } ? Exclude<P, undefined> : never

type PathOperand<P extends string> = { readonly path: P }
type CountOperand<P extends string> = { readonly count: P }
type Left<P extends string> = P | CountOperand<P>
type Right<P extends string> = Scalar | readonly Scalar[] | PathOperand<P> | CountOperand<P>

const node = <P extends string>(expr: Expr): When<P> => ({
  expr,
  because: (description) => ({ kind: 'expr', expr, description }),
})

const left = (operand: Left<string>): Operand =>
  typeof operand === 'string' ? { path: operand } : { count: operand.count }

const right = (operand: Right<string>): Operand => {
  if (Array.isArray(operand)) return { value: [...operand] }
  if (operand !== null && typeof operand === 'object')
    return 'path' in operand
      ? { path: operand.path }
      : { count: (operand as CountOperand<string>).count }
  return { value: operand as Scalar }
}

// a comparison takes a path (or a count) first, and a value, a path or a count second
const comparison =
  (op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in') =>
  <const A extends string, const B extends string = never>(
    a: Left<A>,
    b: Right<B>,
  ): When<NoInfer<A | B>> =>
    node({ [op]: [left(a), right(b)] } as Expr)

// RFC 0001 §3.1's vocabulary, one helper per operator. Plain helpers, not a proxy: what isn't here is a guard
export const when = {
  eq: comparison('eq'),
  ne: comparison('ne'),
  lt: comparison('lt'),
  le: comparison('le'),
  gt: comparison('gt'),
  ge: comparison('ge'),
  // the left is a member of the right, an array
  in: comparison('in'),
  exists: <const P extends string>(path: P): When<NoInfer<P>> => node({ exists: path }),
  all: <const T extends readonly When<string>[]>(...args: T): When<NoInfer<PathsIn<T[number]>>> =>
    node({ all: args.map((a) => a.expr) }),
  any: <const T extends readonly When<string>[]>(...args: T): When<NoInfer<PathsIn<T[number]>>> =>
    node({ any: args.map((a) => a.expr) }),
  not: <P extends string>(arg: When<P>): When<NoInfer<P>> => node({ not: arg.expr }),
  // `where` reads the element as `item`
  some: <const Of extends string, P extends string>(
    of: Of,
    where: When<P>,
  ): When<NoInfer<Of | Rebase<P, Of>>> => node({ some: { of, where: where.expr } }),
  every: <const Of extends string, P extends string>(
    of: Of,
    where: When<P>,
  ): When<NoInfer<Of | Rebase<P, Of>>> => node({ every: { of, where: where.expr } }),
  // a path as the second operand: when.le('input.quantity', when.path('product.stock'))
  path: <const P extends string>(path: P): PathOperand<P> => ({ path }),
  // an array's length: when.gt(when.count('target.items'), 0)
  count: <const P extends string>(path: P): CountOperand<P> => ({ count: path }),
}

export const guard = (description: string): Guard => ({ kind: 'guard', description })
