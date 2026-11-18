import type { Principal } from '@affordances/runtime'
import { runtime } from './runtime.ts'

// the review-and-confirm step of the purchase flow (M7f's plan, §3; intake, 2026-11-18): before a capability that
// requires confirmation charges anything, the page shows the runtime's own confirmation summary, the same text the API
// surfaces approve, so every surface asks the person to approve the same words

/** The actions whose capability requires confirmation, each with the input fields its capability takes. */
export const REVIEWED = {
  subscribe: {
    capability: 'hosting.plan.subscribe',
    fields: ['plan', 'projectId'],
    back: '/plans',
  },
  subscribeBundle: {
    capability: 'hosting.bundle.subscribe',
    fields: ['bundle', 'projectId'],
    back: '/plans',
  },
  addAddOn: { capability: 'hosting.addOn.add', fields: ['projectId', 'addOn'], back: '/add-ons' },
} as const

export type ReviewedAction = keyof typeof REVIEWED

export const isReviewed = (action: unknown): action is ReviewedAction =>
  typeof action === 'string' && Object.hasOwn(REVIEWED, action)

export type Review = {
  action: ReviewedAction
  input: Record<string, string>
  // the summary to approve, as the runtime renders it, charges included; absent when the call is refused for another
  // reason, which is then given
  summary?: string
  refused?: string
}

// the runtime's check, without approval: a capability that requires confirmation refuses with its rendered summary,
// exactly as an execution without approval does on the API surfaces. Nothing runs, and nothing is charged
export const review = async (
  principal: Principal,
  action: ReviewedAction,
  params: Record<string, string | string[] | undefined>,
): Promise<Review> => {
  const spec = REVIEWED[action]
  const input = Object.fromEntries(
    spec.fields.map((f) => [f, typeof params[f] === 'string' ? params[f] : '']),
  )
  const checked = await runtime.check({ principal, offer: spec.capability, input })
  if (checked.status === 'refused' && checked.code === 'confirmation_required')
    return { action, input, summary: checked.confirmation!.summary }
  return {
    action,
    input,
    refused:
      checked.status === 'refused'
        ? (checked.condition?.description ?? checked.detail ?? checked.code)
        : 'This needs no confirmation',
  }
}

/**
 * The review-and-confirm URL for a call the runtime refused for confirmation: the offer's capability, as its reviewed
 * action, and its input's fields. M7f's WebMCP bridge opens it to have the simulated person complete the call, as a
 * person would in this app. Undefined for a capability with no review step.
 */
export const reviewUrl = (offer: string, input: unknown): string | undefined => {
  // an offer id starts with its capability id (RFC 0002 §4.1); a capability id alone is accepted too
  const capability = offer.split('@')[0]
  const action = (Object.keys(REVIEWED) as ReviewedAction[]).find(
    (a) => REVIEWED[a].capability === capability,
  )
  if (!action) return undefined
  const fields = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const params = new URLSearchParams({ action })
  for (const f of REVIEWED[action].fields)
    if (typeof fields[f] === 'string') params.set(f, fields[f] as string)
  return `/review?${params}`
}
