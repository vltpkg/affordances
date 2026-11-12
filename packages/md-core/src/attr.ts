import { decode } from './entities.ts'
import type { Element } from './types.ts'

// an element's attribute by lowercase name: its decoded value, '' for one without a value, undefined when absent.
// the first of a repeated name wins, as in html. parsed from the tag's source on first use
export const attr = (el: Element, name: string): string | undefined =>
  el.attrs === '' ? undefined : (el.map ??= parseAttrs(el.attrs)).get(name)

export const hasAttrs = (el: Element) => el.attrs !== ''

const space = (c: number) => c === 32 || c === 10 || c === 9 || c === 12 || c === 13

// the tokenizer lowercases ascii only, and reads a nul as U+FFFD
const clean = (text: string) => {
  let upper = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if ((c >= 65 && c <= 90) || c === 0) upper = true
  }
  return upper
    ? text.replace(/[A-Z\0]/g, (c) =>
        c === '\0' ? '\uFFFD' : String.fromCharCode(c.charCodeAt(0) | 32),
      )
    : text
}

// the html tokenizer's attribute states, over a start tag's source after its name
export const parseAttrs = (source: string): Map<string, string> => {
  const map = new Map<string, string>()
  const n = source.length
  let i = 0
  while (i < n) {
    let c = source.charCodeAt(i)
    if (space(c) || c === 47) {
      i++
      continue
    }
    // a name runs to whitespace, '/' or '='; an '=' first is part of it
    const start = i++
    while (i < n && !space((c = source.charCodeAt(i))) && c !== 47 && c !== 61) i++
    const name = clean(source.slice(start, i))
    while (i < n && space(source.charCodeAt(i))) i++
    let value = ''
    if (source.charCodeAt(i) === 61) {
      i++
      while (i < n && space(source.charCodeAt(i))) i++
      const quote = source.charCodeAt(i)
      if (quote === 34 || quote === 39) {
        const end = source.indexOf(quote === 34 ? '"' : "'", i + 1)
        value = source.slice(i + 1, end < 0 ? n : end)
        i = end < 0 ? n : end + 1
      } else {
        const from = i
        while (i < n && !space(source.charCodeAt(i))) i++
        value = source.slice(from, i)
      }
      if (value.indexOf('\0') >= 0) value = value.replaceAll('\0', '\uFFFD')
    }
    if (!map.has(name)) map.set(name, decode(value, true))
  }
  return map
}
