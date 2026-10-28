type Segment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'catchAll'; name: string; optional: boolean }

export type CompiledRoute = { pattern: string; segments: Segment[] }

const split = (path: string) => path.split('/').filter(Boolean)

// next's app router patterns: /products/[slug], /docs/[...slug], /shop/[[...slug]]
export const compile = (pattern: string): CompiledRoute => ({
  pattern,
  segments: split(pattern).map((part): Segment => {
    const optional = part.match(/^\[\[\.\.\.(.+)\]\]$/)
    if (optional) return { kind: 'catchAll', name: optional[1]!, optional: true }
    const catchAll = part.match(/^\[\.\.\.(.+)\]$/)
    if (catchAll) return { kind: 'catchAll', name: catchAll[1]!, optional: false }
    const param = part.match(/^\[(.+)\]$/)
    if (param) return { kind: 'param', name: param[1]! }
    return { kind: 'static', value: part }
  }),
})

const rank = { static: 0, param: 1, catchAll: 2 }

// most specific first: per segment, static beats [param] beats [...catchAll]; longer beats shorter on a tie
export const sort = (routes: CompiledRoute[]) =>
  routes.toSorted((a, b) => {
    for (let i = 0; i < Math.max(a.segments.length, b.segments.length); i++) {
      const x = a.segments[i]
      const y = b.segments[i]
      if (!x || !y) return x ? -1 : 1
      if (rank[x.kind] !== rank[y.kind]) return rank[x.kind] - rank[y.kind]
    }
    return 0
  })

export const match = (route: CompiledRoute, path: string) => {
  const parts = split(path).map(decodeURIComponent)
  const params: Record<string, string | string[]> = {}
  for (const [i, segment] of route.segments.entries()) {
    if (segment.kind === 'catchAll') {
      const rest = parts.slice(i)
      if (!rest.length && !segment.optional) return
      if (rest.length) params[segment.name] = rest
      return params
    }
    const part = parts[i]
    if (part === undefined) return
    if (segment.kind === 'static' && segment.value !== part) return
    if (segment.kind === 'param') params[segment.name] = part
  }
  return parts.length === route.segments.length ? params : undefined
}
