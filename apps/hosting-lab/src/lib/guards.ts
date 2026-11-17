import { findAccount, planBySlug } from './store.ts'

// the checks only the application can make, written once: the v0 actions (defineAction's guards) and the
// projection runtime (its handlers, RFC 0002 §11) both call these. A guard returns true ("not ruled out"), or the
// reason it rules the call out. Next-free, so the benchmark's trial process can load them

// the project's plan includes rollback: the plan is on the project, which a deployment doesn't hold
export const planHasRollback = (sid: string | undefined): true | string => {
  const project = sid ? findAccount(sid)?.project : undefined
  if (!project) return 'Sign in to roll back'
  const plan = planBySlug(project.plan)
  return plan.rollback || `${plan.name} doesn't include rollback`
}

// the deployment is one of the caller's own; without a deployment yet (at projection time), not ruled out
export const ownsDeployment = (sid: string | undefined, deployment: unknown): true | string => {
  if (deployment === undefined) return true
  const project = sid ? findAccount(sid)?.project : undefined
  if (!project) return 'Sign in to roll back'
  return (
    project.deployments.some((d) => d.id === deployment) || `No deployment ${String(deployment)}`
  )
}
