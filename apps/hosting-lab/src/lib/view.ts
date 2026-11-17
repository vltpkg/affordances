import { getSessionId } from './session.ts'
import {
  account,
  effectiveAddOns,
  findAccount,
  monthlyUsd,
  planBySlug,
  previewAccount,
  type Account,
} from './store.ts'

// what v0's state loaders read for a caller: their account, or an unsaved preview. A read never makes an account
export const accountFor = (sid: string | null | undefined): Account =>
  (sid ? findAccount(sid) : undefined) ?? previewAccount()

// what a page renders for the person: the UI's own use of their cookie session, which the proxy gives every page
// request (src/proxy.ts). So the page makes the account, and the project its forms name is the one their actions
// act on. Agent-facing reads (v0's graph, the projection routes) never do
export const currentAccount = async () => {
  const sid = await getSessionId()
  return sid ? account(sid) : previewAccount()
}

export const summary = (a: Account) => {
  const plan = planBySlug(a.project.plan)
  return {
    project: a.project.id,
    plan: a.project.bundle ? `${plan.name} (bundle ${a.project.bundle})` : plan.name,
    renewsAs: planBySlug(a.project.renewsAs).name,
    addOns: effectiveAddOns(a.project),
    removing: a.project.removing,
    monthlyUsd: monthlyUsd(a.project),
    buildMinutes: { used: a.project.buildMinutesUsed, included: plan.buildMinutes },
    rollback: plan.rollback,
  }
}
