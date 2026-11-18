import { canonicalJson } from '../canonical.ts'
import { normalize } from '../normalize.ts'
import type { CapabilityManifest, Relation, URI } from '../schema.ts'
import { brandOf, type Brand } from './brand.ts'
import {
  assemble,
  type DefinedCapability,
  type DefinedClaims,
  type DefinedPrincipal,
  type DefinedRelations,
  type DefinedResource,
  type ManifestSpec,
} from './define.ts'

// RFC 0005 §1: a compiler evaluates each capabilities.ts and hands its exports here. Exports are recognized by their
// brand, merged into one manifest, and reported on, never thrown about: author input is diagnosed, not crashed on

/** @experimental One evaluated capability module: its path, for diagnostics, and its exports. */
export type CapabilityModule = { file: string; exports: Record<string, unknown> }

/** @experimental The manifest's identity, from configuration (RFC 0005 §1); a defineManifest export overrides it. */
export type ModuleIdentity = {
  namespace?: URI
  owner?: { id?: string; name: string; href?: URI }
}

/** @experimental What fromModules reports, by RFC 0005 §3's codes; for an IR issue, `subject` is its pointer. */
export type ModuleDiagnostic = {
  code: `E_${string}` | `W_${string}`
  file?: string
  subject?: string
  message: string
}

type Found = { file: string; name: string; brand: Brand; value: unknown }

const where = (f: Found) => `${f.name} in ${f.file}`
const definition = (v: { definition: unknown }) => canonicalJson(v.definition)

/** @experimental One manifest from every capability module's exports, or the diagnostics that stop it. */
export const fromModules = (
  modules: readonly CapabilityModule[],
  identity: ModuleIdentity,
): { manifest?: CapabilityManifest; diagnostics: ModuleDiagnostic[] } => {
  const diagnostics: ModuleDiagnostic[] = []
  // a module's exports are all that's read; one value exported twice, or re-exported, is one value
  const seen = new Set<unknown>()
  const found: Found[] = []
  for (const { file, exports } of modules)
    for (const [name, value] of Object.entries(exports)) {
      const brand = brandOf(value)
      if (!brand || seen.has(value)) continue
      seen.add(value)
      found.push({ file, name, brand, value })
    }

  // a defineManifest export is the whole manifest, so nothing may sit beside it
  const manifests = found.filter((f) => f.brand === 'manifest')
  if (manifests.length) {
    const beside = found.filter((f) => f !== manifests[0])
    for (const other of beside)
      diagnostics.push({
        code: 'E_CAPABILITY_MANIFEST',
        file: other.file,
        subject: other.name,
        message: `${where(other)} sits beside the defineManifest export ${where(manifests[0]!)}, which is used whole`,
      })
    return beside.length
      ? { diagnostics }
      : { manifest: manifests[0]!.value as CapabilityManifest, diagnostics }
  }

  // the namespace is the app's identity, so it's never inferred: without one there's no manifest (RFC 0005 §1)
  if (!identity.namespace)
    return {
      diagnostics: [
        {
          code: 'W_NO_NAMESPACE',
          message: 'No namespace is configured, so no manifest is built',
        },
      ],
    }

  // one definition per id; the same canonical bytes collapse, different ones are reported with both places
  const unite = <T>(brand: Brand, id: (value: T) => string, bytes: (value: T) => string) => {
    const byId = new Map<string, Found>()
    for (const f of found.filter((x) => x.brand === brand)) {
      const key = id(f.value as T)
      const first = byId.get(key)
      if (!first) byId.set(key, f)
      else if (bytes(first.value as T) !== bytes(f.value as T))
        diagnostics.push({
          code: 'E_CAPABILITY_DUPLICATE',
          file: f.file,
          subject: key,
          message: `${key} is defined differently by ${where(first)} and ${where(f)}`,
        })
    }
    return [...byId.values()].map((f) => f.value as T)
  }
  const resources = unite<DefinedResource>('resource', (r) => r.definition.id, definition)
  const capabilities = unite<DefinedCapability>('capability', (c) => c.definition.id, definition)
  // one id names one definition, whatever it is: a resource and a capability can't share one
  const resourceIds = new Set(resources.map((r) => r.definition.id))
  for (const c of capabilities.filter((x) => resourceIds.has(x.definition.id)))
    diagnostics.push({
      code: 'E_CAPABILITY_DUPLICATE',
      subject: c.definition.id,
      message: `${c.definition.id} is both a resource and a capability`,
    })
  const principals = unite<DefinedPrincipal>('principal', () => 'the principal', definition)
  const claims = found.filter((f) => f.brand === 'claims').map((f) => f.value as DefinedClaims)
  // relations have no identity of their own; exact duplicates collapse when the manifest is normalized
  const relations: Relation[] = found
    .filter((f) => f.brand === 'relations')
    .flatMap((f) => (f.value as DefinedRelations).relations)

  // a claim is the owner's assertion, so without an owner there's no one to make it (RFC 0005 §2.2)
  if (!identity.owner) {
    diagnostics.push({
      code: 'W_NO_OWNER',
      message: 'No owner is configured, so nothing is declared',
    })
    for (const f of found.filter((x) => x.brand === 'claims'))
      diagnostics.push({
        code: 'E_CLAIMS_NO_OWNER',
        file: f.file,
        subject: f.name,
        message: `${where(f)} makes claims, and a claim is the owner's: configure an owner`,
      })
  }
  if (diagnostics.some((d) => d.code.startsWith('E_'))) return { diagnostics }

  const spec: ManifestSpec = {
    namespace: identity.namespace,
    ...(identity.owner && { owner: identity.owner }),
    ...(principals[0] && { principal: principals[0] }),
    resources,
    capabilities,
    ...(claims.length && { claims }),
    ...(relations.length && { relations }),
  }
  const result = assemble(spec)
  for (const issue of result.issues)
    diagnostics.push({ code: issue.code, subject: issue.at || '/', message: issue.message })
  const failed = !result.ok || result.issues.some((i) => i.code.startsWith('E_'))
  // normalized, so the order modules were found in never shows (RFC 0001 §7.2)
  return failed ? { diagnostics } : { manifest: normalize(result.manifest), diagnostics }
}
