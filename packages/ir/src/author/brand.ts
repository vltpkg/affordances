// what an authored value is, so a compiler reading a capability module's exports can tell a resource from a capability
// without guessing from shapes (RFC 0005 §1). Symbol.for, so two copies of this package agree; non-enumerable, so it
// never reaches JSON
export const DEFINED = Symbol.for('affordances.defined')

export type Brand = 'resource' | 'principal' | 'capability' | 'claims' | 'relations' | 'manifest'

const brands: ReadonlySet<unknown> = new Set<Brand>([
  'resource',
  'principal',
  'capability',
  'claims',
  'relations',
  'manifest',
])

export const branded = <T extends object>(value: T, brand: Brand): T =>
  Object.defineProperty(value, DEFINED, { value: brand })

export const brandOf = (value: unknown): Brand | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const brand = (value as { [DEFINED]?: unknown })[DEFINED]
  return brands.has(brand) ? (brand as Brand) : undefined
}
