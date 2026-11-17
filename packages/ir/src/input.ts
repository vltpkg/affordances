import { z } from 'zod'

// an input checked against a capability's input schema (RFC 0002 §8.1, step 4): each issue says where and what
export type InputIssue = { at: string; message: string }

const pointer = (path: readonly PropertyKey[]) =>
  path.map((key) => `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')

// a schema zod can't read can't vouch for any input, so it fails closed
export const inputIssues = (schema: unknown, input: unknown): InputIssue[] => {
  let check: z.ZodType
  try {
    check = z.fromJSONSchema(schema as never)
  } catch {
    return [{ at: '', message: "the input schema can't be checked, so no input passes it" }]
  }
  const result = check.safeParse(input)
  return result.success
    ? []
    : result.error.issues.map((i) => ({ at: pointer(i.path), message: i.message }))
}
