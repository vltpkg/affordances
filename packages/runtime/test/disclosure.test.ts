import { describe, expect, test } from 'vitest'
import * as fc from 'fast-check'
import type { CapabilityManifest } from '@affordances/ir'
import type { Projection, View } from '../src/index.ts'

// RFC 0002 §6.3, tested by construction: for each generated case, the first view and every expansion from it must
// reach every offer the principal may see, with exact counts, whole choice sets, and every alternative one listed
// expansion away, the partners read from the generated relations
import { NS, caseArb, requestOf, runtimeOf, type Case } from './support/generate.ts'

const ids = (v: View) => v.offers.map((o) => o.id)
// a definition's own id, for a Ref that names it with the namespace
const local = (ref: string) => (ref.startsWith(`${NS}#`) ? ref.slice(NS.length + 1) : ref)
// alternativeTo, both ways, from the generated relations: the partners the runtime must never hide
const partnersOf = (m: CapabilityManifest, capability: string) => {
  return new Set(
    (m.relations ?? []).flatMap((r) =>
      r.type !== 'alternativeTo'
        ? []
        : local(r.from) === capability
          ? [local(r.to)]
          : local(r.to) === capability
            ? [local(r.from)]
            : [],
    ),
  )
}

// every broken promise for one case; empty when the invariant holds
const problems = async (c: Case): Promise<string[]> => {
  const found: string[] = []
  const request = requestOf(c)
  const p: Projection = await runtimeOf(c).project(request)
  const all = new Set(p.offers.map((o) => o.id))
  const check = (v: View, where: string) => {
    for (const s of p.choiceSets) {
      const shown = s.members.filter((m) => ids(v).includes(m)).length
      if (shown !== 0 && shown !== s.members.length) found.push(`${where}: ${s.id} shown in part`)
    }
    // rule 6 (§6.6): every choice set the view carries, shown or summarized, comes with its comparison, every
    // declared attribute but the key, one row per member; the generated requests set no facts, so nothing is cut
    const carried = [
      ...v.choiceSets.map((s) => ({ id: s.id, comparison: s.comparison, count: s.members.length })),
      ...v.omitted.expand
        .filter((e) => e.along === 'members')
        .map((e) => ({ id: e.from as string, comparison: e.comparison, count: e.count })),
    ]
    for (const { id, comparison, count } of carried) {
      if (!comparison) {
        found.push(`${where}: ${id} carries no comparison`)
        continue
      }
      const set = p.choiceSets.find((s) => s.id === id)!
      const resource = c.spec.manifest.resources.find((r) => local(r.id) === local(set.over))
      const declared = Object.keys(
        (resource?.attributes as { properties?: object } | undefined)?.properties ?? {},
      )
        .filter((a) => a !== resource?.key)
        .toSorted()
      const columns = [...comparison.differ, ...Object.keys(comparison.shared)].toSorted()
      if (JSON.stringify(columns) !== JSON.stringify(declared))
        found.push(`${where}: ${id}'s comparison has ${columns}, not ${declared}`)
      if (comparison.rows.length !== count) found.push(`${where}: ${id}'s comparison lacks rows`)
      if (comparison.omitted.attributes.length) found.push(`${where}: ${id}'s comparison is cut`)
    }
    if (v.omitted.offers !== all.size - v.offers.length)
      found.push(`${where}: omitted.offers inexact`)
    if (v.omitted.choiceSets !== p.choiceSets.length - v.choiceSets.length)
      found.push(`${where}: omitted.choiceSets inexact`)
    for (const o of v.offers) {
      const partners = partnersOf(c.spec.manifest, o.capability)
      if (o.alternatives.count !== partners.size)
        found.push(
          `${where}: ${o.id} counts ${o.alternatives.count} alternatives, not ${partners.size}`,
        )
      const hidden = p.offers.some((x) => partners.has(x.capability) && !ids(v).includes(x.id))
      if (hidden && !v.omitted.expand.some((e) => e.from === o.id && e.along === 'alternatives'))
        found.push(`${where}: ${o.id}'s alternatives aren't listed`)
    }
  }
  const reached = new Set<string>()
  const queue: [View, string][] = [[p.view(), 'view']]
  const seen = new Set<string>()
  while (queue.length) {
    const [v, where] = queue.shift()!
    check(v, where)
    for (const id of ids(v)) reached.add(id)
    for (const e of v.omitted.expand) {
      const key = JSON.stringify([e.from, e.along])
      if (seen.has(key)) continue
      seen.add(key)
      const full = await p.expand(e)
      if (full.offers.length !== e.count)
        found.push(`${key}: returned ${full.offers.length} of ${e.count}`)
      queue.push([await p.expand(e, { budget: request.budget }), key])
    }
  }
  for (const id of all) if (!reached.has(id)) found.push(`${id} unreachable`)
  // every alternative of every shown offer, in one expansion
  for (const o of p.view().offers) {
    const partners = partnersOf(c.spec.manifest, o.capability)
    if (!partners.size) continue
    const alt = new Set(ids(await p.expand({ from: o.id, along: 'alternatives' })))
    for (const x of p.offers)
      if (partners.has(x.capability) && !alt.has(x.id))
        found.push(`${x.id} isn't one step from ${o.id}`)
  }
  // availability never decides what's shown (rule 5): with every condition and requirement gone, the same ids
  const open = structuredClone(c.spec.manifest)
  for (const cap of open.capabilities) {
    delete cap.preconditions
    delete cap.authorization
  }
  const opened = await runtimeOf({ ...c, spec: { manifest: open, guards: [] } }, open).project(
    request,
  )
  if (JSON.stringify(ids(opened.view())) !== JSON.stringify(ids(p.view())))
    found.push('availability changed which offers the first view shows')
  // the same request again gives the same bytes, and the policy is no input of the revision
  const again = await runtimeOf(c).project(request)
  if (JSON.stringify(again.view()) !== JSON.stringify(p.view())) found.push('not deterministic')
  const exhaustive = await runtimeOf(c).project({ ...request, policy: 'exhaustive' })
  if (exhaustive.revision !== p.revision) found.push('the policy moved the revision')
  return found
}

describe('the disclosure invariant, generated (§6.3)', () => {
  test('holds for 1,000 seeded cases, and a failure shrinks to its smallest', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        expect(await problems(c)).toEqual([])
      }),
      {
        numRuns: Number(process.env.RUNS ?? 1000),
        seed: 20261117,
        endOnFailure: process.env.RUNS !== undefined,
      },
    )
  }, 300_000)
})
