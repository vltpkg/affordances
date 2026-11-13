import { isDeepStrictEqual } from 'node:util'
import { parseAttrs } from '../../../src/convert/core/attr.ts'
import { parse } from '../../../src/convert/core/parse.ts'
import type { Element } from '../../../src/convert/core/types.ts'
import { oracle, plain } from './support/oracle.ts'

const attrs = (el: Element) => Object.fromEntries(parseAttrs(el.attrs))

// the parser's Document and the oracle's, as plain data
export const both = (html: string) => ({
  ours: plain(parse(html), attrs),
  theirs: plain(oracle(html), attrs),
})

export const agrees = (html: string) => {
  const { ours, theirs } = both(html)
  return isDeepStrictEqual(ours, theirs)
}

// the first place the two differ, for a readable failure
export const difference = (html: string): string | undefined => {
  const { ours, theirs } = both(html)
  const walk = (a: unknown, b: unknown, path: string): string | undefined => {
    if (isDeepStrictEqual(a, b)) return undefined
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const found = walk(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          `${path}.${key}`,
        )
        if (found) return found
      }
    }
    return `${path}: ours ${JSON.stringify(a)?.slice(0, 300)}, oracle ${JSON.stringify(b)?.slice(0, 300)}`
  }
  return walk(ours, theirs, '')
}
