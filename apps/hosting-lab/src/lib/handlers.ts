import type { Handler, Principal, TokenStore } from '@affordances/runtime'
import { ownsDeployment, planHasRollback } from './guards.ts'
import { accountOf } from './resolvers.ts'
import * as store from './store.ts'

// what the projection runtime runs for each capability (RFC 0002 §11): its guards, its run once every check has
// passed (§8.1, step 9), and the sentence to repeat. The same store calls as the v0 actions make. Next-free, so a
// benchmark trial can load them

// the caller's account id: execution reaches run only after authorization passed, so there's an account
const caller = (principal: Principal) => {
  const a = accountOf(principal)
  if (!a) throw new Error('Sign in first')
  return a.id
}

type Input = Record<string, string>
const fields = (i: unknown) => i as Input

export const handlers: Record<string, Handler> = {
  'hosting.plan.list': { run: () => store.planRows() },
  'hosting.project.read': {
    run: (_, { principal }) => {
      const project = store.accountById(caller(principal))!.project
      return store.projectAttributes(project)
    },
  },
  'hosting.subscription.cancel': {
    run: (i, { principal }) => store.cancel(caller(principal), fields(i).projectId!),
    message: () => 'The project renews as Hobby at the end of the month',
  },
  'hosting.plan.subscribe': {
    run: (i, { principal }) =>
      store.subscribePlan(caller(principal), fields(i).projectId!, fields(i).plan!),
  },
  'hosting.bundle.subscribe': {
    run: (i, { principal }) =>
      store.subscribeBundle(caller(principal), fields(i).projectId!, fields(i).bundle!),
  },
  'hosting.addOn.add': {
    run: (i, { principal }) =>
      store.addAddOn(caller(principal), fields(i).projectId!, fields(i).addOn!),
  },
  'hosting.addOn.remove': {
    run: (i, { principal }) =>
      store.removeAddOn(caller(principal), fields(i).projectId!, fields(i).addOn!),
  },
  'hosting.deployment.create': {
    run: (i, { principal }) =>
      store.deploy(caller(principal), fields(i).projectId!, fields(i).ref!),
    message: ({ output }) => {
      const d = output as { id: string; status: string }
      return `Deployment ${d.id} is ${d.status}`
    },
  },
  'hosting.deployment.rollback': {
    guards: {
      planHasRollback: ({ principal }) => planHasRollback(accountOf(principal)),
      owns: ({ input, target, principal }) =>
        ownsDeployment(accountOf(principal), input?.deployment ?? target?.key),
    },
    run: (i, { principal }) => store.rollback(caller(principal), fields(i).deployment!),
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
