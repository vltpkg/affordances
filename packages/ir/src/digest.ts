import { canonicalJson } from './canonical.ts'
import { normalize } from './normalize.ts'
import type { CapabilityManifest } from './schema.ts'

// the canonical bytes (RFC 0001 §7.2): the UTF-8 of the normalized manifest's RFC 8785 serialization
export const canonicalize = (manifest: CapabilityManifest): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(canonicalJson(normalize(manifest)))

// the manifest's digest (§7.1): 'sha256-' and base64url without padding (RFC 4648 §5). Web Crypto, so it's the same
// on every platform that has it: Node 20+, browsers, edge runtimes
export const digest = async (manifest: CapabilityManifest): Promise<string> => {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalize(manifest)))
  const base64 = btoa(String.fromCharCode(...hash))
  return `sha256-${base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`
}
