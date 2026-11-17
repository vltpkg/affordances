import { planBySlug, type Account } from './store.ts'

// the checks only the application can make, written once: the v0 actions (defineAction's guards) and the
// projection runtime (its handlers, RFC 0002 §11) both call these, each with the caller's account as it finds it:
// v0 by the session, the runtime by the principal. A guard returns true ("not ruled out"), or the reason it rules
// the call out. Next-free, so the benchmark's trial process can load them

// the project's plan includes rollback: the plan is on the project, which a deployment doesn't hold
export const planHasRollback = (caller: Account | undefined): true | string => {
  if (!caller) return 'Sign in to roll back'
  const plan = planBySlug(caller.project.plan)
  return plan.rollback || `${plan.name} doesn't include rollback`
}

// the deployment is one of the caller's own; without a deployment yet (at projection time), not ruled out
export const ownsDeployment = (caller: Account | undefined, deployment: unknown): true | string => {
  if (deployment === undefined) return true
  if (!caller) return 'Sign in to roll back'
  return (
    (typeof deployment === 'string' && caller.project.deployments.has(deployment)) ||
    `No deployment ${String(deployment)}`
  )
}
