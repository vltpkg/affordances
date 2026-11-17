import { canonicalJson, type Context } from '@affordances/ir'

type Obj = Record<string, unknown>

// RFC 0001 §3.2: strings as written, other values as their RFC 8785 text, an unresolved path as `unknown`
export const render = (summary: string, context: Context) =>
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
