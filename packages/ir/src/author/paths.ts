// condition paths, typed against the schemas they read (RFC 0001 §12.1). Type-level only: at run time a path is
// the string RFC 0001 §3.1 defines, and validate's E_PATH checks the same thing for manifests loaded as JSON

// depth limit, so recursive and very deep types stay finite: a quantifier nested in another reads at most
// root.array.<element>.array.<element>.attribute
type Depth = [never, 0, 1, 2, 3, 4, 5, 6]

// an array's elements, as a path segment. Type-level only, and a private-use character, so a path someone writes
// (`target.items.[].sku`) never matches it: RFC 0001's paths reach elements only through a quantifier's `item`
export type Element = '\u{E000}'

// the dotted paths into a value of type T, with an array's elements as the Element segment
export type PathsOf<T, D extends number = 6> = [D] extends [never]
  ? never
  : NonNullable<T> extends readonly (infer E)[]
    ? Element | `${Element}.${PathsOf<E, Depth[D]>}`
    : NonNullable<T> extends object
      ? {
          [K in keyof NonNullable<T> & string]: K | `${K}.${PathsOf<NonNullable<T>[K], Depth[D]>}`
        }[keyof NonNullable<T> & string]
      : never

// every path a condition may read, from the values each root holds
export type ContextPaths<Ctx> = {
  [R in keyof Ctx & string]: `${R}.${PathsOf<Ctx[R]>}`
}[keyof Ctx & string]

// inside a quantifier's `where`, `item` is the element of the array at `of`. Rewriting `item` to `<of>.<Element>`
// checks a `where`'s paths against the element type, and composes for a nested quantifier
export type Rebase<P extends string, Of extends string> = P extends 'item'
  ? `${Of}.${Element}`
  : P extends `item.${infer Rest}`
    ? `${Of}.${Element}.${Rest}`
    : P
