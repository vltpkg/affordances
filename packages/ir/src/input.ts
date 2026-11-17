import { z } from 'zod'
import { encodePointer } from './pointer.ts'

// an input checked against a capability's input schema (RFC 0002 §8.1, step 4): each issue says where and what
export type InputIssue = { at: string; message: string }

// a schema zod can't read can't vouch for any input, so it fails closed
// each schema object is compiled once (simplify D5): a manifest's schemas don't change while it's in use. null for one
// that can't be compiled
const compiled = new WeakMap<object, z.ZodType | null>()
const compile = (schema: unknown): z.ZodType | null => {
  const cached = schema !== null && typeof schema === 'object' ? compiled.get(schema) : undefined
  if (cached !== undefined) return cached
  let check: z.ZodType | null
  try {
    check = z.fromJSONSchema(schema as never)
  } catch {
    check = null
  }
  if (schema !== null && typeof schema === 'object') compiled.set(schema, check)
  return check
}

export const inputIssues = (schema: unknown, input: unknown): InputIssue[] => {
  const check = compile(schema)
  if (!check) return [{ at: '', message: "the input schema can't be checked, so no input passes it" }]
  const result = check.safeParse(input)
  return result.success
    ? []
    : result.error.issues.map((i) => ({ at: encodePointer(i.path), message: i.message }))
}
