import type { Handler, Principal, TokenStore } from '@affordances/runtime'
import { ownsDeployment, planHasRollback } from './guards.ts'
import * as store from './store.ts'

// what the projection runtime runs for each capability (RFC 0002 §11): its guards, its run once every check has
// passed (§8.1, step 9), and the sentence to repeat. The same store calls as the v0 actions make. Next-free, so a
// benchmark trial can load them

const sidOf = (principal: Principal) => (principal.authenticated ? principal.subject : undefined)

// the caller's session: execution reaches run only after authorization passed, so it's there
const sid = (principal: Principal) => {
  const s = sidOf(principal)
  if (!s) throw new Error('Sign in first')
  return s
}

type Input = Record<string, string>
const fields = (i: unknown) => i as Input

export const handlers: Record<string, Handler> = {
  'hosting.plan.list': { run: () => store.planRows() },
  'hosting.project.read': {
    run: (_, { principal }) => {
      const project = store.findAccount(sid(principal))?.project
      if (!project) throw new Error('No project')
      return store.projectAttributes(project)
    },
  },
  'hosting.subscription.cancel': {
    run: (i, { principal }) => store.cancel(sid(principal), fields(i).projectId!),
    message: () => 'The project renews as Hobby at the end of the month',
  },
  'hosting.plan.subscribe': {
    run: (i, { principal }) =>
      store.subscribePlan(sid(principal), fields(i).projectId!, fields(i).plan!),
  },
  'hosting.bundle.subscribe': {
    run: (i, { principal }) =>
      store.subscribeBundle(sid(principal), fields(i).projectId!, fields(i).bundle!),
  },
  'hosting.addOn.add': {
    run: (i, { principal }) =>
      store.addAddOn(sid(principal), fields(i).projectId!, fields(i).addOn!),
  },
  'hosting.addOn.remove': {
    run: (i, { principal }) =>
      store.removeAddOn(sid(principal), fields(i).projectId!, fields(i).addOn!),
  },
  'hosting.deployment.create': {
    run: (i, { principal }) => store.deploy(sid(principal), fields(i).projectId!, fields(i).ref!),
    message: ({ output }) => {
      const d = output as { id: string; status: string }
      return `Deployment ${d.id} is ${d.status}`
    },
  },
  'hosting.deployment.rollback': {
    guards: {
      planHasRollback: ({ principal }) => planHasRollback(sidOf(principal)),
      owns: ({ input, target, principal }) =>
        ownsDeployment(sidOf(principal), input?.deployment ?? target?.key),
    },
    run: (i, { principal }) => store.rollback(sid(principal), fields(i).deployment!),
    message: ({ output }) => `${(output as { current: string }).current} is published again`,
  },
}

// each approval token's nonce, so a token runs once (RFC 0002 §8.2). In memory, as the store is: one per process
export const memoryTokens = (): TokenStore => {
  const seen = new Map<string, number>()
  return {
    claim: async (nonce, expiresAt) => {
      const now = Date.now()
      for (const [n, at] of seen) if (at <= now) seen.delete(n)
      if (seen.has(nonce)) return false
      seen.set(nonce, expiresAt.getTime())
      return true
    },
  }
}
