import { ENTITIES } from './entities-table.ts'

// character references, decoded as the html tokenizer does: the full named table (legacy names also without ';', the
// longest one that matches), the attribute exception, and numeric references with the spec's replacements
const NAMED = new Map(Object.entries(ENTITIES))
// the longest name the table has without a ';'
let LEGACY_MAX = 0
for (const name of NAMED.keys())
  if (!name.endsWith(';')) LEGACY_MAX = Math.max(LEGACY_MAX, name.length)
// the longest name with its ';', so a run of letters past it can't be one
const NAME_MAX = 32

// &#128;-&#159; are read as windows-1252, as browsers always have; 0 keeps the code point
const C1 = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
  0x203a, 0x0153, 0, 0x017e, 0x0178,
]

const numeric = (code: number) => {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD'
  if (code >= 0x80 && code <= 0x9f && C1[code - 0x80]) return String.fromCharCode(C1[code - 0x80]!)
  return String.fromCodePoint(code)
}

const alnum = (c: number) => (c >= 48 && c <= 57) || ((c | 32) >= 97 && (c | 32) <= 122)

// attribute: decoding an attribute's value, where a legacy name followed by '=' or an alphanumeric isn't a reference
export const decode = (text: string, attribute = false): string => {
  let amp = text.indexOf('&')
  if (amp < 0) return text
  const n = text.length
  let out = ''
  let from = 0
  while (amp >= 0) {
    const i = amp + 1
    let value: string | undefined
    let end = i
    if (text.charCodeAt(i) === 35) {
      // &#123; or &#x7b;, the ';' optional; with no digits it is only text
      let j = i + 1
      const hex = (text.charCodeAt(j) | 32) === 120
      if (hex) j++
      const digits = j
      let code = 0
      for (; j < n; j++) {
        const c = text.charCodeAt(j)
        let digit: number
        if (c >= 48 && c <= 57) digit = c - 48
        else if (hex && (c | 32) >= 97 && (c | 32) <= 102) digit = (c | 32) - 87
        else break
        // past the last code point it stays past it, without growing toward a float
        if (code <= 0x10ffff) code = code * (hex ? 16 : 10) + digit
      }
      if (j > digits) {
        value = numeric(code)
        end = text.charCodeAt(j) === 59 ? j + 1 : j
      }
    } else {
      let j = i
      while (j < n && j - i <= NAME_MAX && alnum(text.charCodeAt(j))) j++
      if (j > i) {
        if (text.charCodeAt(j) === 59) value = NAMED.get(text.slice(i, j + 1))
        if (value !== undefined) end = j + 1
        else
          // without its ';', the longest legacy name the letters start with
          for (let k = Math.min(j, i + LEGACY_MAX); k > i; k--) {
            value = NAMED.get(text.slice(i, k))
            if (value === undefined) continue
            const next = text.charCodeAt(k)
            if (attribute && (next === 61 || alnum(next))) value = undefined
            else end = k
            break
          }
      }
    }
    if (value !== undefined) {
      out += text.slice(from, amp) + value
      from = end
    }
    amp = text.indexOf('&', end)
  }
  return from === 0 ? text : from >= n ? out : out + text.slice(from)
}
