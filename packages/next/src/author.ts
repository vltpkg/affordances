// the authoring API a capability module imports (RFC 0005 §1), re-exported from @affordances/ir, next's optional peer,
// at runtime and in types alike. It's the one entry of next that references ir: an app that
// imports it has ir installed, and an app that doesn't never loads it

/** @experimental RFC 0001 §12.1's authoring API, from `@affordances/ir`; requires it installed in the app. */
export {
  defineCapability,
  defineClaims,
  defineManifest,
  definePrincipal,
  defineRelations,
  defineResource,
  guard,
  when,
  type ContextPaths,
  type Declared,
  type DefinedCapability,
  type DefinedClaims,
  type DefinedPrincipal,
  type DefinedRelations,
  type DefinedResource,
  type Guard,
  type GuardsOf,
  type Infer,
  type InputOf,
  type OutputOf,
  type PathsOf,
  type StandardSchemaV1,
  type When,
} from '@affordances/ir'
