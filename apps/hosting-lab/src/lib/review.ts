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
