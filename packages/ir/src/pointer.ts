// RFC 6901 JSON Pointers: '/a/b~1c' names a, then b/c. One implementation, so every reader of a manifest's pointers
// (targetAt, a reference's at, a claim's about) agrees on what they name
const unescape = (token: string) => token.replaceAll('~1', '/').replaceAll('~0', '~')
const escape = (token: string) => token.replaceAll('~', '~0').replaceAll('/', '~1')

// the tokens a pointer names, in order; '' is the whole value
export const decodePointer = (pointer: string): string[] =>
  pointer === '' ? [] : pointer.split('/').slice(1).map(unescape)

export const encodePointer = (tokens: readonly PropertyKey[]): string =>
  tokens.map((t) => `/${escape(String(t))}`).join('')

// the value a pointer names, own keys only, or undefined
export const getPointer = (value: unknown, pointer: string): unknown => {
  let node = value
  for (const key of decodePointer(pointer))
    node =
      node !== null && typeof node === 'object' && Object.hasOwn(node, key)
        ? (node as Record<string, unknown>)[key]
        : undefined
  return node
}

// sets the value a pointer names, making the objects on the way
export const putPointer = (value: Record<string, unknown>, pointer: string, item: unknown) => {
  const keys = decodePointer(pointer)
  let node = value
  for (const key of keys.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[keys.at(-1)!] = item
}
