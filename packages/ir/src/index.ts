export * from './schema.ts'
export { jsonSchema } from './json-schema.ts'
export { validate, type Validation } from './validate.ts'
export { normalize } from './normalize.ts'
export { byCanonical, canonicalJson, compare } from './canonical.ts'
export { base64url, canonicalize, digest, digestOf } from './digest.ts'
export { compose, type Composition } from './compose.ts'
export { derive, satisfies, type DerivedEdge } from './derive.ts'
export {
  all,
  compareValues,
  evaluate,
  resolvePath,
  type Context,
  type Resolved,
  type Truth,
} from './evaluate.ts'
export { decodePointer, encodePointer, getPointer, putPointer } from './pointer.ts'
export { localId } from './ref.ts'
export { renderConfirmation, renderSummary } from './summary.ts'
export {
  conformanceCases,
  falsifying,
  fitContext,
  searchFalsifying,
  type ConformanceCase,
  type Falsified,
} from './falsify.ts'
export { applyDefaults, inputIssues, type InputIssue } from './input.ts'
export * from './author/index.ts'
