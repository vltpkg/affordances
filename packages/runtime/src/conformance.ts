import {
  conformanceCases,
  falsifying,
  type CapabilityDefinition,
  type Context,
  type Expr,
  type Id,
} from '@affordances/ir'
import { offerId } from './offer-id.ts'
import { createRuntime, type RuntimeOptions } from './project.ts'
import type { ExecutionResult, GuardImpl, Handler, Principal } from './types.ts'

// RFC 0002 §9, R5: rule 5's conformance kit. For each declarative precondition and authorization condition, ir
// derives a state in which it alone is false (conformanceCases); for each guard, the kit forces it to false with
// every declarative condition true. The kit has the application's fixture arrange that state, executes the
// capability through the application's own resolvers and handlers, with an approval, and expects a refusal that
// names the condition. A capability that runs when it should refuse fails conformance

export type ConformanceFixture = {
  // the application's runtime options: its resolvers over a store arrange writes to, and its real handlers
  options: RuntimeOptions
  // put an instance in the store, with these attributes
  arrange(type: Id, key: string, attributes: Record<string, unknown>): void | Promise<void>
  // the caller: the kit fills in the attributes each case needs, and signs it in
  principal: Principal
  // an input that passes the capability's input schema, which the kit adds each case's input to
  input?(capability: Id): Record<string, unknown>
}

export type ConformanceResult = {
  capability: Id
  condition: string
  kind: 'declarative' | 'guard'
  // false: the condition implies another, so a refusal can't be pinned on it alone (falsify.ts)
  isolated: boolean
  pass: boolean
  got: ExecutionResult
}

const KEY = 'conformance'

export const conformance = async (fixture: ConformanceFixture): Promise<ConformanceResult[]> => {
  const { manifest } = fixture.options
  const handlers = fixture.options.handlers ?? {}
  const results: ConformanceResult[] = []
  // the attribute a resource type's key is
  const keyOf = (type: Id) => manifest.resources.find((r) => r.id === type)!.key

  // every guard passes, except the one under test; the handler's run is the application's own
  const forced = (c: CapabilityDefinition, failing?: string): Record<Id, Handler> => {
    const guards: Record<string, GuardImpl> = {}
    for (const x of [...(c.preconditions ?? []), ...(c.authorization?.conditions ?? [])])
      if ('guard' in x) guards[x.id] = () => x.id !== failing
    return { ...handlers, [c.id]: { ...handlers[c.id], guards } }
  }

  // arrange a case's context, execute with an approval, and say whether it was refused for that condition
  const attempt = async (
    c: CapabilityDefinition,
    condition: string,
    context: Context,
    failing?: string,
  ): Promise<{ got: ExecutionResult; named: boolean; byCondition: boolean }> => {
    // an instance's key is its key attribute: the case's value when it sets one, which may be what's falsified
    const keyFor = (
      type: Id,
      attributes: Record<string, unknown> | undefined,
      fallback: string,
    ) => {
      const given = attributes?.[keyOf(type)]
      return typeof given === 'string' ? given : fallback
    }
    const targetKey = c.target ? keyFor(c.target, context.target, KEY) : undefined
    if (c.target)
      await fixture.arrange(c.target, targetKey!, {
        ...context.target,
        [keyOf(c.target)]: targetKey,
      })
    const input: Record<string, unknown> = { ...fixture.input?.(c.id), ...context.input }
    for (const r of c.references ?? []) {
      const key = keyFor(r.resource, context.references?.[r.name], `${KEY}-${r.name}`)
      await fixture.arrange(r.resource, key, {
        ...context.references?.[r.name],
        [keyOf(r.resource)]: key,
      })
      put(input, r.at, key)
    }
    const principal: Principal = {
      ...fixture.principal,
      authenticated: true,
      attributes: { ...fixture.principal.attributes, ...context.principal },
    }
    const runtime = createRuntime({ ...fixture.options, handlers: forced(c, failing) })
    const offer = c.target
      ? offerId({ capability: c.id, target: { type: c.target, key: targetKey! } })
      : c.id
    let got = await runtime.execute({ principal, offer, input })
    if (
      got.status === 'refused' &&
      got.code === 'confirmation_required' &&
      got.confirmation?.approval
    )
      got = await runtime.execute({ principal, offer, input, approval: got.confirmation.approval })
    // refused by a condition, not for a missing instance or a confirmation the kit couldn't give
    const byCondition =
      got.status === 'refused' && (got.code === 'precondition' || got.code === 'unauthorized')
    const named = byCondition && (got as { condition?: { id: string } }).condition?.id === condition
    return { got, named, byCondition }
  }

  for (const k of conformanceCases(manifest)) {
    const c = manifest.capabilities.find((x) => x.id === k.capability)!
    if (!k.context) continue
    const { got, named, byCondition } = await attempt(c, k.condition, k.context)
    // a case that isn't isolated passes on a condition's refusal: something it implies may have refused first
    // (review of M3d: never on not_found from an arrange that did nothing, or a leftover confirmation)
    results.push({
      capability: c.id,
      condition: k.condition,
      kind: 'declarative',
      isolated: k.isolated,
      pass: k.isolated ? named : byCondition,
      got,
    })
  }

  for (const c of manifest.capabilities) {
    const conditions = [...(c.authorization?.conditions ?? []), ...(c.preconditions ?? [])]
    const exprs = conditions.flatMap((x) => ('expr' in x ? [x.expr as Expr] : []))
    // a context where every declarative condition holds: not all of them is false there
    const context = exprs.length ? falsifying({ not: { all: exprs } }) : {}
    for (const x of conditions) {
      if (!('guard' in x)) continue
      if (!context) continue
      const { got, named } = await attempt(c, x.id, context, x.id)
      results.push({
        capability: c.id,
        condition: x.id,
        kind: 'guard',
        isolated: true,
        pass: named,
        got,
      })
    }
  }
  return results
}

const put = (value: Record<string, unknown>, pointer: string, item: unknown) => {
  const keys = pointer
    .split('/')
    .slice(1)
    .map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'))
  let node = value
  for (const key of keys.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[keys.at(-1)!] = item
}
