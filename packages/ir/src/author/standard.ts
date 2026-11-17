import type { JSONSchema } from '../schema.ts'

// the parts of Standard Schema (https://standardschema.dev) authoring reads. The spec asks libraries to copy its
// interfaces rather than depend on a package, so the IR keeps its one dependency
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (
      value: unknown,
      options?: { readonly libraryOptions?: Record<string, unknown> | undefined } | undefined,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
  }
}

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string
        readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
      }>
    }

// Standard JSON Schema: a schema that can describe itself as JSON Schema
type JSONSchemaConverter = {
  readonly input: (options: { readonly target: 'draft-2020-12' }) => Record<string, unknown>
}

export type Infer<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never

// authoring takes Standard Schema and the IR stores JSON Schema 2020-12, without $schema (RFC 0001 §12.1, §7.2)
export const toJsonSchema = (schema: StandardSchemaV1, what: string): JSONSchema => {
  const converter = (schema['~standard'] as { jsonSchema?: JSONSchemaConverter }).jsonSchema
  if (!converter)
    throw new TypeError(
      `${what}: this schema (${schema['~standard'].vendor}) can't produce JSON Schema. Use a library that implements Standard JSON Schema, such as zod 4`,
    )
  const { $schema: _, ...rest } = converter.input({ target: 'draft-2020-12' })
  return rest
}
