import {
  addOns,
  bundles,
  plans as catalogPlans,
  withPlanIds,
  type AddOn,
  type Bundle,
  type Plan,
} from '../catalog.ts'

// the hosting provider's state, in memory: one account per session, each with one project. Every change the
// manifest declares is observable here: the project's plan and renewal, its add-ons and bundle, its deployments,
// and a ledger of every charge. No database and no payments: state lives as long as the server process

export type Charge = { at: string; description: string; usd: number }

export type Deployment = {
  id: string
  ref: string
  status: 'building' | 'ready' | 'failed' | 'rolledBack'
  current: boolean
  createdAt: string
}

export type Project = {
  id: string
  ownerId: string
  plan: Plan['slug']
  bundle: Bundle['slug'] | null
  // the plan it moves to at the next renewal: its plan, unless it was cancelled
  renewsAs: Plan['slug']
  // the add-ons bought on their own. A bundle's included add-ons aren't here: they come and go with the bundle
  addOns: AddOn['slug'][]
  // add-ons that stop at the next renewal
  removing: AddOn['slug'][]
  buildMinutesUsed: number
  deployments: Deployment[]
}

export type Account = { id: string; project: Project; ledger: Charge[] }

// each deploy uses this many build minutes, so a plan's allowance runs out in a few deploys on Hobby
export const MINUTES_PER_DEPLOY = 25

// the process's store, on globalThis: Next.js can load this module once per route bundle, and pages, server actions
// and the API routes must all see one store. Before, each copy made its own account with the same ids, which hid it
type State = {
  accounts: Map<string, Account>
  // the plans, with the ids this process assigns them. A benchmark trial permutes the ids (RFC 0003 §4), and the
  // store and the resolvers read the same assignment, so an offer for p2 and the plan p2 executes are the same
  plans: readonly Plan[]
  nextDeployment: number
}
const shared = globalThis as { hostingLabStore?: State }
const state = (shared.hostingLabStore ??= {
  accounts: new Map(),
  plans: catalogPlans,
  nextDeployment: 1,
})

export const currentPlans = () => state.plans
export const setPlanIds = (order: readonly [string, string, string]) => {
  state.plans = withPlanIds(order)
}

const now = () => new Date().toISOString()

export const planBySlug = (slug: Plan['slug']) => state.plans.find((p) => p.slug === slug)!
export const addOnBySlug = (slug: string) => addOns.find((a) => a.slug === slug)
export const bundleBySlug = (slug: string) => bundles.find((b) => b.slug === slug)

// the session's account if it has one. Reads use this, so a read for an unknown session creates nothing
export const findAccount = (sid: string): Account | undefined => state.accounts.get(sid)

// the plans as the plan list answers them
export const planRows = () =>
  state.plans.map(({ slug, name, priceUsd, buildMinutes, bandwidthGb, rollback, support }) => ({
    slug,
    name,
    priceUsd,
    buildMinutes,
    bandwidthGb,
    rollback,
    support,
  }))

// the session's account, made on first use: for what a session does, never for what it reads
export const account = (sid: string): Account => {
  let found = state.accounts.get(sid)
  if (!found) {
    found = {
      id: sid,
      project: {
        id: `proj_${sid.slice(0, 8)}`,
        ownerId: sid,
        plan: 'hobby',
        bundle: null,
        renewsAs: 'hobby',
        addOns: [],
        removing: [],
        buildMinutesUsed: 0,
        deployments: [],
      },
      ledger: [],
    }
    state.accounts.set(sid, found)
  }
  return found
}

const includedIn = (project: Project): AddOn['slug'][] =>
  (project.bundle ? bundleBySlug(project.bundle)?.addOns : undefined) ?? []

// the add-ons the project has: bought, and included in its bundle
export const effectiveAddOns = (project: Project): AddOn['slug'][] => [
  ...new Set([...project.addOns, ...includedIn(project)]),
]

// what the project pays a month: the bundle's price or the plan's, and bought add-ons the bundle doesn't include
export const monthlyUsd = (project: Project): number => {
  const bundle = project.bundle ? bundleBySlug(project.bundle) : undefined
  const included = new Set(includedIn(project))
  return (
    (bundle ? bundle.priceUsd : planBySlug(project.plan).priceUsd) +
    project.addOns
      .filter((a) => !included.has(a))
      .reduce((sum, a) => sum + addOnBySlug(a)!.priceUsd, 0)
  )
}

// the project's attributes, as the manifest declares them (hosting.project)
export const projectAttributes = (project: Project) => ({
  id: project.id,
  ownerId: project.ownerId,
  plan: project.plan,
  renewsAs: project.renewsAs,
  addOns: effectiveAddOns(project),
  buildMinutesUsed: project.buildMinutesUsed,
  buildMinutesIncluded: planBySlug(project.plan).buildMinutes,
})

const charge = (a: Account, description: string, usd: number) => {
  if (usd > 0) a.ledger.push({ at: now(), description, usd })
}

// a refusal the store makes itself. v0's UI path doesn't evaluate declared conditions (RFC 0001 §8.3), so the
// store enforces the domain's rules in code too, whatever path a call came by
export class Refused extends Error {}

// the caller's project, by its key: a project the caller doesn't own is refused like one that doesn't exist
const owned = (sid: string, projectId: string): Account => {
  const a = account(sid)
  if (a.project.id !== projectId) throw new Refused(`No project ${projectId}`)
  return a
}

// ---- what the capabilities do ----

export const subscribePlan = (sid: string, projectId: string, planId: string) => {
  const a = owned(sid, projectId)
  const plan = state.plans.find((p) => p.id === planId)
  if (!plan) throw new Refused(`No plan ${planId}`)
  const slug = plan.slug
  if (a.project.plan === slug && !a.project.bundle)
    throw new Refused(`${plan.name} is already the plan`)
  a.project.plan = slug
  a.project.bundle = null
  a.project.renewsAs = slug
  // the first month now; it isn't refunded
  charge(a, `${plan.name}, first month`, plan.priceUsd)
  return { plan: slug, monthlyUsd: monthlyUsd(a.project) }
}

export const subscribeBundle = (sid: string, projectId: string, slug: string) => {
  const a = owned(sid, projectId)
  const bundle = bundleBySlug(slug)
  if (!bundle) throw new Refused(`No bundle ${slug}`)
  if (a.project.bundle === bundle.slug) throw new Refused(`${bundle.name} is already the plan`)
  a.project.plan = bundle.plan
  a.project.bundle = bundle.slug
  a.project.renewsAs = bundle.plan
  charge(a, `${bundle.name}, first month`, bundle.priceUsd)
  return { bundle: slug, monthlyUsd: monthlyUsd(a.project) }
}

export const cancel = (sid: string, projectId: string) => {
  const a = owned(sid, projectId)
  if (a.project.renewsAs === 'hobby') throw new Refused('The project already renews as Hobby')
  // the plan stays until the end of the month; it renews as Hobby
  a.project.renewsAs = 'hobby'
  return { renewsAs: 'hobby' as const }
}

export const addAddOn = (sid: string, projectId: string, slug: string) => {
  const a = owned(sid, projectId)
  const addOn = addOnBySlug(slug)
  if (!addOn) throw new Refused(`No add-on ${slug}`)
  if (includedIn(a.project).includes(addOn.slug))
    throw new Refused(`${addOn.name} is included in the project's bundle`)
  if (a.project.addOns.includes(addOn.slug) && !a.project.removing.includes(addOn.slug))
    throw new Refused(`The project already has ${addOn.name}`)
  if (!a.project.addOns.includes(addOn.slug)) a.project.addOns = [...a.project.addOns, addOn.slug]
  a.project.removing = a.project.removing.filter((r) => r !== addOn.slug)
  charge(a, `${addOn.name}, first month`, addOn.priceUsd)
  return { addOns: a.project.addOns }
}

export const removeAddOn = (sid: string, projectId: string, slug: string) => {
  const a = owned(sid, projectId)
  const addOn = addOnBySlug(slug)
  if (addOn && includedIn(a.project).includes(addOn.slug) && !a.project.addOns.includes(addOn.slug))
    throw new Refused(`${addOn.name} comes with the bundle: change the plan to drop it`)
  if (!addOn || !a.project.addOns.includes(addOn.slug))
    throw new Refused(`The project doesn't have ${addOn?.name ?? slug}`)
  // it stops at the end of the month
  if (!a.project.removing.includes(addOn.slug)) a.project.removing.push(addOn.slug)
  return { removing: a.project.removing }
}

export const deploy = (sid: string, projectId: string, ref: string) => {
  const a = owned(sid, projectId)
  if (a.project.buildMinutesUsed >= planBySlug(a.project.plan).buildMinutes)
    throw new Refused("The plan's build minutes for this month are used up")
  const deployment: Deployment = {
    id: `dep_${state.nextDeployment++}`,
    ref,
    // a build of a ref named "broken" fails, so a failed deployment can be shown
    status: ref.includes('broken') ? 'failed' : 'ready',
    current: false,
    createdAt: now(),
  }
  a.project.buildMinutesUsed += MINUTES_PER_DEPLOY
  if (deployment.status === 'ready') {
    for (const d of a.project.deployments) d.current = false
    deployment.current = true
  }
  a.project.deployments.unshift(deployment)
  return { id: deployment.id, status: deployment.status }
}

// the checks rollback's guards make, shared with the agent path's guard implementations
export const rollbackRefusal = (sid: string, id: string): string | undefined => {
  const a = account(sid)
  const target = a.project.deployments.find((d) => d.id === id)
  if (!target) return `No deployment ${id}`
  if (!planBySlug(a.project.plan).rollback)
    return `${planBySlug(a.project.plan).name} doesn't include rollback`
  if (target.status !== 'ready') return `${id} didn't build`
  if (target.current) return `${id} is already published`
  return undefined
}

export const rollback = (sid: string, id: string) => {
  const a = account(sid)
  const refusal = rollbackRefusal(sid, id)
  if (refusal) throw new Refused(refusal)
  for (const d of a.project.deployments) d.current = d.id === id
  return { current: id }
}

// for tests: forget every account
export const reset = () => {
  state.accounts.clear()
  state.plans = catalogPlans
  state.nextDeployment = 1
}
