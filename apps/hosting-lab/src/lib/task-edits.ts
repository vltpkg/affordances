import type { CapabilityManifest } from '@affordances/ir'

// the confirmatory fixture's claim edit (RFC 0003 §3.1, design 2026-11-18): on T6 and T7 the owner's recommendation is
// on Business, not Pro. One named edit, applied identically wherever a T6 or T7 trial reads the manifest: in process
// (choice-bench's setupTrial) and on a trial's own server (src/lib/trial-env.ts), so every surface's agent reads the
// same claims (surfaces/PLAN.md §2). T1 to T5 keep Pro recommended
export type TaskEdit = { name: string; apply: (m: CapabilityManifest) => CapabilityManifest }

export const TASK_EDITS: Record<string, TaskEdit> = Object.fromEntries(
  ['T6', 'T7'].map((task) => [
    task,
    {
      name: 'owner-recommends-business',
      apply: (m: CapabilityManifest) => {
        const out = structuredClone(m)
        const claims = out.claims ?? []
        const at = claims.findIndex((c) => c.id === 'proRecommended')
        if (at < 0) throw new Error('the fixture has no proRecommended claim to move')
        claims[at] = {
          ...claims[at]!,
          id: 'businessRecommended',
          statement:
            'Recommended for busy production sites: 1,000 GB of bandwidth and priority support included',
          applies: { eq: [{ path: 'target.slug' }, { value: 'business' }] },
          // the facts its statement relies on (RFC 0001 §9, design 2026-11-18), so a facts budget never cuts them
          // from a view that shows the claim (RFC 0002 §6.6)
          cites: ['bandwidthGb', 'support'],
        }
        return out
      },
    },
  ]),
)
