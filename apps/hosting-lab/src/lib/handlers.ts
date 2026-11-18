import { HandlerRefusal, type Handler, type Principal } from '@affordances/runtime'
import { ownsDeployment, planHasRollback } from './guards.ts'
import { accountOf, projectOf } from './resolvers.ts'
import { messages } from './messages.ts'
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

const defined: Record<string, Handler> = {
  'hosting.plan.list': { run: () => store.planRows() },
  'hosting.project.read': {
    run: (_, { principal }) => {
      caller(principal)
      return store.projectAttributes(projectOf(principal)!)
    },
  },
  'hosting.subscription.cancel': {
    run: (i, { principal }) => store.cancel(caller(principal), fields(i).projectId!),
    message: messages.cancelled,
  },
  'hosting.plan.subscribe': {
    // addOns comes only with condition G's manifest edit (RFC 0003 §3.1)
    run: (i, { principal }) =>
      store.subscribePlan(
        caller(principal),
        fields(i).projectId!,
        fields(i).plan!,
        (i as { addOns?: string[] }).addOns,
      ),
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
    message: messages.deployed,
  },
  'hosting.deployment.rollback': {
    guards: {
      planHasRollback: ({ principal }) => planHasRollback(accountOf(principal)),
      owns: ({ input, target, principal }) =>
        ownsDeployment(accountOf(principal), input?.deployment ?? target?.key),
    },
    run: (i, { principal }) => store.rollback(caller(principal), fields(i).deployment!),
    message: messages.rolledBack,
  },
}

// a call the store refuses after every check passed, such as approving the bundle the project already has, is the
// caller's to correct: the runtime's refusal, never a failure a trial counts as a server error (code review of M8, #2).
// The store throws before it changes anything
const refusing =
  (run: NonNullable<Handler['run']>): Handler['run'] =>
  async (input, ctx) => {
    try {
      return await run(input, ctx)
    } catch (error) {
      if (error instanceof store.Refused) throw new HandlerRefusal(error.message)
      throw error
    }
  }

export const handlers: Record<string, Handler> = Object.fromEntries(
  Object.entries(defined).map(([id, h]) => [id, h.run ? { ...h, run: refusing(h.run) } : h]),
)

// each approval token's nonce, so a token runs once (RFC 0002 §8.2). In memory, as the store is: one per process
export { memoryTokenStore as memoryTokens } from '@affordances/runtime'
