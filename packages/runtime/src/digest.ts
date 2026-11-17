import { canonicalJson } from '@affordances/ir'

// sha256- and base64url without padding, over a value's RFC 8785 bytes: the form RFC 0002 §7's revisions take
export const digestOf = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const base64 = btoa(String.fromCharCode(...hash))
  return `sha256-${base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
}
