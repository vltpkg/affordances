import { canonicalJson } from './canonical.ts'
import { normalize } from './normalize.ts'
import type { CapabilityManifest } from './schema.ts'

// the canonical bytes (RFC 0001 §7.2): the UTF-8 of the normalized manifest's RFC 8785 serialization
export const canonicalize = (manifest: CapabilityManifest): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(canonicalJson(normalize(manifest)))

// base64url without padding (RFC 4648 §5)
export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

// a value's digest: 'sha256-' and the base64url of SHA-256 over its RFC 8785 bytes. Web Crypto, so it's the same on
// every platform that has it: Node 20+, browsers, edge runtimes. The manifest's digest (§7.1) and RFC 0002's
// revisions are both this
export const digestOf = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  return `sha256-${base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))}`
}

// the manifest's digest (§7.1): its normalized form's
export const digest = (manifest: CapabilityManifest): Promise<string> =>
  digestOf(normalize(manifest))
