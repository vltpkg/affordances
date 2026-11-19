import { evaluate, type Condition, type Context, type Id, type Truth } from '@affordances/ir'
import type { GuardImpl, Principal, ResourceResolver } from './types.ts'

// what projection and execution share in deciding a condition

export type GuardArgs = Parameters<GuardImpl>[0]

// a guard's answer, read once: true, false, a string that rules out and says why, or null for a throw or anything
// that isn't one of those (§4.2)
export const guardTruth = async (
  guard: GuardImpl,
  args: GuardArgs,
): Promise<boolean | string | null> => {
  try {
    const said = await guard(args)
    return typeof said === 'boolean' || typeof said === 'string' ? said : null
  } catch {
    return null
  }
}

// one condition: a declarative one evaluated, a guard run with the args it's given. withInput is execution: there,
// an execution-only guard runs too. guard is what a guard that ran said, for the revisions (§7)
export type Decision = { value: Truth; detail?: string; guard?: boolean | string | null }
export const decideCondition = async (
  condition: Condition,
  context: Context,
  guard: GuardImpl | undefined,
  args: GuardArgs,
  { withInput }: { withInput: boolean },
): Promise<Decision> => {
  if ('expr' in condition) return { value: evaluate(condition.expr, context) }
  if (!guard || (guard.executionOnly && !withInput)) return { value: 'unknown' }
  const said = await guardTruth(guard, args)
  if (typeof said === 'string') return { value: false, detail: said, guard: said }
  return { value: said === null ? 'unknown' : said, guard: said }
}

// the instances of a type a projection offers on, or an execution observes: the start's key, then every key the
// resolver lists. A list that throws enumerates nothing more
export const instancesOf = async (
  resolver: ResourceResolver,
  principal: Principal,
  capability: Id,
  startKey?: string,
): Promise<string[]> => {
  const keys = new Set<string>()
  if (startKey !== undefined) keys.add(startKey)
  try {
    for (const key of (await resolver.list?.(principal, { capability })) ?? []) keys.add(key)
  } catch {
    // only the start's
  }
  return [...keys]
}
