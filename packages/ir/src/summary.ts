import { canonicalJson } from './canonical.ts'
import { resolvePath, type Context } from './evaluate.ts'

// RFC 0001 §3.2: a confirmation summary's template, filled from a context. Strings as written, other values as their
// RFC 8785 text, an unresolved path as `unknown`, and {{ }} for literal braces. A path resolves as conditions resolve
// it, own keys only; a key holding null renders null. One renderer, so a runtime and an authoring layer show a person
// the same sentence
export const renderSummary = (template: string, context: Context): string =>
  template.replaceAll(/\{\{|\}\}|\{([^{}]*)\}/g, (whole, path: string | undefined) => {
    if (path === undefined) return whole[0]!
    const resolved = resolvePath(path, context)
    if (resolved.kind === 'value')
      return typeof resolved.value === 'string' ? resolved.value : canonicalJson(resolved.value)
    return resolved.kind === 'absent' && resolved.null ? 'null' : 'unknown'
  })
