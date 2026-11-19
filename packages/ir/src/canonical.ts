// RFC 8785 (JCS): object members sorted by UTF-16 code units, no whitespace, numbers and strings as ECMAScript's
// JSON.stringify writes them. That matches JCS for I-JSON input: finite IEEE 754 numbers, no lone surrogates
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${value} isn't I-JSON`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    // the default sort compares UTF-16 code units, which is RFC 8785's order
    const keys = Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .toSorted()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  throw new TypeError(`${typeof value} isn't JSON`)
}

// orders a set's elements by their canonical bytes, for ties and for sets keyed by nothing else
export const byCanonical = (a: unknown, b: unknown) => compare(canonicalJson(a), canonicalJson(b))

// UTF-16 code unit order, as JCS and §3.1's string comparisons use; not localeCompare
export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
