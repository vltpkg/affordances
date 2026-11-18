import { v0Bindings } from '@affordances/hosting-lab/trial'
import { canonicalJson } from '@affordances/ir'
import type { BrowserLoad, BrowserRecord } from './browser-server.ts'
import type { ConditionId } from './conditions.ts'
import type { CapabilityRequest } from './v0.ts'

// the browser surface's request events (surfaces/PLAN.md §5): the first load of the review-and-confirm page carrying a
// selection, and the confirm click. A selection is the review page's action and its fields, the same names as the
// app's bound actions and their capabilities' inputs (hosting-lab's src/lib/review.ts), so it maps to its capability
// by the app's own table, as v0's calls do. The PLAN's alternate rule, fixed before the pilot: the confirm click with
// the review-page load just before it

/** A browser trial's record, with what the replay needs, and which of the two request-event rules to read by. */
export type BrowserTrial = BrowserRecord & {
  condition: ConditionId
  index: number
  task: string
  project: string
  rule: 'first-load' | 'confirm-load'
}

const capabilityOfAction = (action: string) => {
  const bound = v0Bindings.filter((b) => b.action === action)
  return bound.length === 1 ? bound[0]!.capability : undefined
}
const requestOf = (selection: Record<string, string>): CapabilityRequest | undefined => {
  const { action, ...input } = selection
  const capability = action ? capabilityOfAction(action) : undefined
  return capability ? { capability, input } : undefined
}
const reviews = (record: Pick<BrowserRecord, 'loads'>) =>
  record.loads.filter(
    (l): l is BrowserLoad & { review: Record<string, string> } =>
      !!l.review && !!requestOf(l.review),
  )
// the review load the confirm submitted: the last before it
const loadBefore = (record: Pick<BrowserRecord, 'loads'>, at: number) =>
  reviews(record)
    .filter((l) => l.at <= at)
    .at(-1)

/** The request events, in order, each once, by the rule asked for. */
export const browserRequestsOf = (
  record: Pick<BrowserRecord, 'loads' | 'confirms'>,
  rule: 'first-load' | 'confirm-load',
): CapabilityRequest[] => {
  const loads =
    rule === 'first-load'
      ? reviews(record)
      : record.confirms.flatMap((c) => {
          const l = loadBefore(record, c.at)
          return l ? [l] : []
        })
  const seen = new Set<string>()
  return loads.flatMap((l) => {
    const r = requestOf(l.review)!
    const key = canonicalJson(r)
    if (seen.has(key)) return []
    seen.add(key)
    return [r]
  })
}

/** The time of the first request event under the first-load rule, the PLAN's default. */
export const firstRequestAt = (record: Pick<BrowserRecord, 'loads'>) => reviews(record)[0]?.at

/** §5's browsing load: a review-page load followed, with no confirm between, by a load carrying a different selection. */
export const browsingLoad = (record: Pick<BrowserRecord, 'loads' | 'confirms'>) => {
  const rs = reviews(record)
  return rs.some((l, i) =>
    rs
      .slice(i + 1)
      .some(
        (later) =>
          canonicalJson(later.review) !== canonicalJson(l.review) &&
          !record.confirms.some((c) => c.at >= l.at && c.at < later.at),
      ),
  )
}

/**
 * A completed purchase: a confirm whose next load left the review step, as a confirmed purchase redirects back. A
 * confirm that failed stays on the review page, so a later Back doesn't count.
 */
export const browserCompleted = (record: Pick<BrowserRecord, 'loads' | 'confirms'>) =>
  record.confirms.some((c) => {
    const next = record.loads.find((l) => l.at >= c.at)
    return !!next && new URL(next.url).pathname !== '/review'
  })
