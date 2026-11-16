import { decode } from './entities.ts'
import type { Element } from './types.ts'

// an element's attribute by lowercase name: its decoded value, '' for one without a value, undefined when absent.
// the first of a repeated name wins, as in html. the first two questions each read just that name out of the tag's
// source (a link's href and title, a span's style); an element asked a third time straight after gets its map built
export const attr = (el: Element, name: string): string | undefined => {
  if (el.map) return el.map.get(name)
  if (el.attrs === '') return undefined
  if (el !== last) {
    last = el
    asked = 0
  } else if (++asked > 1) return (el.map = parseAttrs(el.attrs)).get(name)
  return scanAttr(el.attrs, name)
}
// the element the last questions without a map were about, and how many more there were after the first
let last: Element | undefined
let asked = 0
// let go of it once the page is read, and with it the page's tree
export const endAttrs = () => {
  last = undefined
  asked = 0
}

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

// one attribute out of a start tag's source, read by the same states as parseAttrs, with no map: the value of the
// first attribute whose name is `name` (ascii lowered, a nul read as U+FFFD), decoded, or undefined
export const scanAttr = (source: string, name: string): string | undefined => {
  const n = source.length
  const size = name.length
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
    let match = i - start === size
    for (let k = 0; match && k < size; k++) {
      const d = source.charCodeAt(start + k)
      match = (d >= 65 && d <= 90 ? d | 32 : d === 0 ? 0xfffd : d) === name.charCodeAt(k)
    }
    while (i < n && space(source.charCodeAt(i))) i++
    let from = i
    let to = i
    if (source.charCodeAt(i) === 61) {
      i++
      while (i < n && space(source.charCodeAt(i))) i++
      const quote = source.charCodeAt(i)
      if (quote === 34 || quote === 39) {
        const end = source.indexOf(quote === 34 ? '"' : "'", i + 1)
        from = i + 1
        to = end < 0 ? n : end
        i = end < 0 ? n : end + 1
      } else {
        from = i
        while (i < n && !space(source.charCodeAt(i))) i++
        to = i
      }
    }
    if (!match) continue
    let value = source.slice(from, to)
    if (value.indexOf('\0') >= 0) value = value.replaceAll('\0', '\uFFFD')
    return decode(value, true)
  }
  return undefined
}
