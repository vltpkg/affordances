import { describe, expect, test } from 'vitest'
import * as fc from 'fast-check'
import type { CapabilityOffer, Projection, View } from '../src/index.ts'
import { caseArb, requestOf, runtimeOf, type Case } from './support/generate.ts'

// RFC 0002 §11 and §6: a projection is runtime-internal, and every agent-facing response carries only what the
// caller's policy discloses, shaped as that policy shapes it. Checked for each response type there is, so a new one
// joins this list:
// - a view, and every expansion from it;
// - inspect, the one documented exception: it returns the offer's claims whatever the policy (§6.5)
// - check, and a refusal: no offers and no claims at all;
// - an execution's changes: offers only from the caller's view after, and ids only from its views before or after.
// By the disclosure invariant, expansions reach every offer, so "beyond what the view and its expansions disclose"
// is about claims and shape, which is what the checks below pin

// every object in a response that's an offer, wherever it sits
const offersIn = (value: unknown): CapabilityOffer[] => {
  if (Array.isArray(value)) return value.flatMap(offersIn)
  if (value === null || typeof value !== 'object') return []
  const o = value as Record<string, unknown>
  const own =
    typeof o.id === 'string' && 'availability' in o && 'claims' in o ? [o as CapabilityOffer] : []
  return [...own, ...Object.values(o).flatMap(offersIn)]
}

const problems = async (c: Case): Promise<string[]> => {
  const found: string[] = []
  const request = requestOf(c)
  // a run that changes state, so executions have changes to report: it bumps every instance's n, and toggles
  // whether the first instance of each type is listed and whether the second is visible, so offers come and go
  const run = () => {
    for (const list of Object.values(c.state)) {
      for (const i of list) i.n = (i.n + 1) % 4
      if (list[0]) list[0].listed = !list[0].listed
      if (list[1]) list[1].fate = list[1].fate === 'none' ? 'found' : 'none'
    }
  }
  const rt = runtimeOf(c, c.spec.manifest, run)
  const p: Projection = await rt.project(request)
  const v = p.view()
  const omits =
    c.policy.id === request.policy
      ? c.policy.claims === 'omitted'
      : request.policy === 'progressive'
  // every response but inspect: no claim when the policy omits them, and every offer one the projection has
  const shaped = (where: string, response: unknown) => {
    for (const o of offersIn(response)) {
      if (!p.offers.some((x) => x.id === o.id) && !where.startsWith('execute'))
        found.push(`${where}: ${o.id} isn't in the projection`)
      if (omits && o.claims.length) found.push(`${where}: ${o.id} carries claims its policy omits`)
    }
  }
  shaped('view', v)
  const seen = new Set<string>()
  const queue: View[] = [v]
  while (queue.length) {
    const next = queue.shift()!
    for (const e of next.omitted.expand) {
      const key = JSON.stringify([e.from, e.along])
      if (seen.has(key)) continue
      seen.add(key)
      const view = await p.expand(e, request.budget ? { budget: request.budget } : undefined)
      shaped(`expand ${key}`, view)
      queue.push(view)
    }
  }
  for (const o of v.offers.slice(0, 8)) {
    // inspect: the documented exception, claims whatever the policy, and nothing about any other offer
    const details = await p.inspect(o.id)
    const others = offersIn(details).filter((x) => x.id !== o.id)
    if (others.length) found.push(`inspect ${o.id}: carries other offers`)
    // check: no offers, no claims
    const checked = await rt.check({ principal: request.principal, offer: o.id, input: {} })
    if (offersIn(checked).length || 'claims' in checked)
      found.push(`check ${o.id}: carries offers or claims`)
    // execute: a refusal carries none, and changes come only from the caller's views
    // the caller's view as the execution measures it: from its start, or the target when it gives none
    const asSeen = { ...request, start: request.start ?? o.target } as never
    const before = new Set(ids((await rt.project(asSeen)).view()))
    const result = await rt.execute({
      principal: request.principal,
      offer: o.id,
      input: {},
      // the caller's projection request, whole (simplify C2)
      view: { ...request, principal: undefined } as never,
    } as never)
    if (result.status === 'refused') {
      if (offersIn(result).length) found.push(`execute ${o.id}: a refusal carries offers`)
      continue
    }
    const after = (await rt.project(asSeen)).view()
    shaped(`execute ${o.id}`, result)
    const now = new Set(ids(after))
    for (const x of result.changes.added)
      if (!now.has(x.id)) found.push(`execute ${o.id}: added ${x.id} isn't in the view after`)
    for (const id of result.changes.removed)
      if (!before.has(id)) found.push(`execute ${o.id}: removed ${id} wasn't in the view`)
    for (const x of result.changes.changed)
      if (!before.has(x.id) && !now.has(x.id))
        found.push(`execute ${o.id}: changed ${x.id} is in neither view`)
    if (result.changes.changed.length || result.changes.added.length) executedWithChanges++
  }
  return found
}
const ids = (v: View) => v.offers.map((o) => o.id)
const opened = (c: Case): Case => {
  const o = structuredClone(c)
  for (const cap of o.spec.manifest.capabilities) {
    delete cap.preconditions
    cap.authorization = { principal: 'any' }
  }
  o.spec.guards = []
  o.principal = { ...o.principal, authenticated: true }
  return o
}
// how many executions had changes to report: a run where none did would check nothing
let executedWithChanges = 0

describe('agent-facing responses disclose only what the caller’s policy does (§11)', () => {
  test('for 300 generated cases, across every response type', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        expect(await problems(structuredClone(c))).toEqual([])
        // and opened up, so most executions succeed and report changes: no preconditions, authorization for anyone
        expect(await problems(opened(c))).toEqual([])
      }),
      {
        numRuns: Number(process.env.RUNS ?? 300),
        seed: 20261118,
        endOnFailure: process.env.RUNS !== undefined,
      },
    )
    expect(executedWithChanges).toBeGreaterThan(0)
  }, 300_000)
})
