// condition paths, typed against the schemas they read (RFC 0001 §12.1). Type-level only: at run time a path is
// the string RFC 0001 §3.1 defines, and validate's E_PATH checks the same thing for manifests loaded as JSON

// depth limit, so recursive and very deep types stay finite: a quantifier nested in another reads at most
// root.array.[].array.[].attribute
type Depth = [never, 0, 1, 2, 3, 4, 5, 6]

// the dotted paths into a value of type T; an array's elements are the segment `[]`
export type PathsOf<T, D extends number = 6> = [D] extends [never]
  ? never
  : NonNullable<T> extends readonly (infer E)[]
    ? '[]' | `[].${PathsOf<E, Depth[D]>}`
    : NonNullable<T> extends object
      ? {
          [K in keyof NonNullable<T> & string]: K | `${K}.${PathsOf<NonNullable<T>[K], Depth[D]>}`
        }[keyof NonNullable<T> & string]
      : never

// every path a condition may read, from the values each root holds
export type ContextPaths<Ctx> = {
  [R in keyof Ctx & string]: `${R}.${PathsOf<Ctx[R]>}`
}[keyof Ctx & string]

// inside a quantifier's `where`, `item` is the element of the array at `of`. Rewriting `item` to `<of>.[]`
// checks a `where`'s paths against the element type, and composes for a nested quantifier
export type Rebase<P extends string, Of extends string> = P extends 'item'
  ? `${Of}.[]`
  : P extends `item.${infer Rest}`
    ? `${Of}.[].${Rest}`
    : P
