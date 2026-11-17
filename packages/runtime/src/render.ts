import { canonicalJson, resolvePath, type Context } from '@affordances/ir'

// RFC 0001 §3.2: strings as written, other values as their RFC 8785 text, an unresolved path as `unknown`. A path is
// resolved as conditions resolve it, own keys only; a key there holding null renders null
export const render = (summary: string, context: Context) =>
  summary.replaceAll(/\{\{|\}\}|\{([^{}]*)\}/g, (whole, path: string | undefined) => {
    if (path === undefined) return whole[0]!
    const resolved = resolvePath(path, context)
    if (resolved.kind === 'value')
      return typeof resolved.value === 'string' ? resolved.value : canonicalJson(resolved.value)
    return resolved.kind === 'absent' && resolved.null ? 'null' : 'unknown'
  })
