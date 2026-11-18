import { inputIssues, type CapabilityManifest, type Id } from '@affordances/ir'

// I-JSON (RFC 7493) plain data: what an attribute value can be. A non-finite number, a BigInt, undefined, a hole, a
// Date or any other object that isn't plain can't be compared or digested, so it's no value
export const plainData = (value: unknown): boolean => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!(i in value) || !plainData(value[i])) return false
    return true
  }
  if (typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return (proto === Object.prototype || proto === null) && Object.values(value).every(plainData)
}

// a resolver's attributes for an instance: plain data that fits the type's declared attributes, or none at all,
// which §2.1 reads as a resolver that couldn't supply them
export const attributesFor = (manifest: CapabilityManifest) => {
  const schemas = new Map(manifest.resources.map((r) => [r.id, r.attributes]))
  return (type: Id, attributes: unknown): Record<string, unknown> | undefined => {
    if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) return
    if (!plainData(attributes)) return
    const schema = schemas.get(type)
    if (schema !== undefined && inputIssues(schema, attributes).length) return
    return attributes as Record<string, unknown>
  }
}
