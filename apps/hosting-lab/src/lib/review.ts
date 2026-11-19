import { inputOf, parseOfferId, type Principal } from '@affordances/runtime'
import { runtime } from './runtime.ts'
import { Refused } from './store.ts'

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
 * Why a Confirm didn't purchase, as the review page says it. The URL carries only one of these codes, never text, so
 * no link can put its own words on the page; what's true now comes from a fresh review beside it.
 */
export const NOT_CONFIRMED = {
  changed:
    'What you reviewed has changed since, so nothing was charged. Here it is as it stands now.',
  refused: "That can't be done any more, so nothing was charged.",
} as const

export type NotConfirmed = keyof typeof NOT_CONFIRMED

export const isNotConfirmed = (code: unknown): code is NotConfirmed =>
  typeof code === 'string' && Object.hasOwn(NOT_CONFIRMED, code)

/**
 * A Confirm, handled: the call is checked again first, and runs only if the summary is still the one the person
 * approved. A refusal, the runtime's or the store's, is an answer for the page, never a thrown error and a 500.
 */
export const confirmReviewed = async (
  principal: Principal,
  action: ReviewedAction,
  form: FormData,
  run: (form: FormData) => Promise<unknown>,
): Promise<'confirmed' | NotConfirmed> => {
  const params = Object.fromEntries(
    REVIEWED[action].fields.map((f) => [f, form.get(f)?.toString()]),
  )
  const now = await review(principal, action, params)
  if (!now.summary) return 'refused'
  if (now.summary !== form.get('seen')?.toString()) return 'changed'
  // only the capability's own fields reach the action: the seen summary isn't its input
  const input = new FormData()
  for (const [k, v] of Object.entries(now.input)) input.set(k, v)
  try {
    await run(input)
  } catch (error) {
    // the store refuses a call the state no longer allows (src/lib/store.ts's Refused), as a second tab's stale
    // Confirm finds; anything else is a real failure, and stays one
    if (error instanceof Refused) return 'refused'
    throw error
  }
  return 'confirmed'
}

/**
 * The review-and-confirm URL for a call the runtime refused for confirmation: the offer's capability, as its reviewed
 * action, and its input's fields. M7f's WebMCP bridge opens it to have the simulated person complete the call, as a
 * person would in this app. Undefined for a capability with no review step.
 */
export const reviewUrl = (offer: string, input: unknown): string | undefined => {
  // the offer's capability (RFC 0002 §4.1); a capability id alone is an offer id too
  const capability = parseOfferId(offer)?.capability
  const action = (Object.keys(REVIEWED) as ReviewedAction[]).find(
    (a) => REVIEWED[a].capability === capability,
  )
  if (!action) return undefined
  // the fields the offer id fixes, where the manifest says they go, then what the call's own input says
  const fields = {
    ...inputOf(runtime.manifest, offer),
    ...(input && typeof input === 'object' ? input : {}),
  } as Record<string, unknown>
  const params = new URLSearchParams({ action })
  for (const f of REVIEWED[action].fields)
    if (typeof fields[f] === 'string') params.set(f, fields[f] as string)
  return `/review?${params}`
}
