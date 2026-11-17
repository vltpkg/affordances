import type { CapabilityManifest, Id } from './schema.ts'

// the local id a Ref names: itself, or '<this manifest's namespace>#<id>'. undefined for a definition in another
// manifest, which this one can't resolve (RFC 0001 §2)
export const localId = (
  manifest: Pick<CapabilityManifest, 'namespace'>,
  ref: string,
): Id | undefined =>
  ref.includes('#')
    ? ref.startsWith(`${manifest.namespace}#`)
      ? ref.slice(manifest.namespace.length + 1)
      : undefined
    : ref
