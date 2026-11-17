import { getSessionId } from './session.ts'
import { account, monthlyUsd, planBySlug, type Account } from './store.ts'

// what a page shows for the caller: their account, or a fresh one before they've done anything
export const accountFor = (sid: string | null | undefined): Account =>
  sid ? account(sid) : account('anonymous-preview')

export const currentAccount = async () => accountFor(await getSessionId())

export const summary = (a: Account) => {
  const plan = planBySlug(a.project.plan)
  return {
    project: a.project.id,
    plan: a.project.bundle ? `${plan.name} (bundle ${a.project.bundle})` : plan.name,
    renewsAs: planBySlug(a.project.renewsAs).name,
    addOns: a.project.addOns,
    removing: a.project.removing,
    monthlyUsd: monthlyUsd(a.project),
    buildMinutes: { used: a.project.buildMinutesUsed, included: plan.buildMinutes },
    rollback: plan.rollback,
  }
}
