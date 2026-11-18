export { brandOf, DEFINED, type Brand } from './brand.ts'
export {
  AUTHORING_SOURCE,
  defineCapability,
  defineClaims,
  defineManifest,
  definePrincipal,
  defineRelations,
  defineResource,
  type DefinedCapability,
  type DefinedClaims,
  type DefinedPrincipal,
  type DefinedRelations,
  type DefinedResource,
  type ManifestSpec,
  type GuardsOf,
  type InputOf,
  type OutputOf,
} from './define.ts'
export {
  fromModules,
  type CapabilityModule,
  type ModuleDiagnostic,
  type ModuleIdentity,
} from './modules.ts'
export type { ContextPaths, PathsOf } from './paths.ts'
export type { Infer, StandardSchemaV1 } from './standard.ts'
export { guard, when, type Declared, type Guard, type When } from './when.ts'
