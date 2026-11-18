import * as lab from '@affordances/hosting-lab/trial'
import { canonicalJson } from '@affordances/ir'
import type {
  CapabilityOffer,
  ExecutionResult,
  OfferDetails,
  Projection,
  ResourceRef,
  View,
} from '@affordances/runtime'
import { z } from 'zod'
import type { Condition } from './conditions.ts'
import type { Trial } from './trial.ts'

// RFC 0003 §5.1's benchmark tools over one trial's runtime. Their names, descriptions and input schemas are the same
// in every condition: only what the runtime returns differs. A response is only ever a View, OfferDetails or an
// ExecutionResult, never a Projection (RFC 0002 §11)

const ref = z.object({ type: z.string(), key: z.string() })
export const TOOLS = {
  project: {
    description:
      'See the actions available to you, and the options among them. Starts from the user’s project unless you name another resource.',
    inputSchema: { start: ref.optional() },
  },
  expand: {
    description:
      'See more of what a view counted but didn’t show: pass one of its omitted.expand entries’ from and along.',
    inputSchema: {
      from: z.union([z.string(), ref]),
      along: z.enum(['alternatives', 'members', 'relations', 'contains', 'enables', 'more']),
    },
  },
  inspect: {
    description: 'See one offer in full: its definition, conditions, effects and claims.',
    inputSchema: { offer: z.string() },
  },
  execute: {
    description:
      'Do an offer’s action. If it needs the user’s approval, the response says so and carries an approval token: call again with approval set to it.',
    inputSchema: {
      offer: z.string(),
      input: z.record(z.string(), z.unknown()).optional(),
      approval: z.string().optional(),
    },
  },
} as const
export type ToolName = keyof typeof TOOLS

export const MAX_CALLS = 30 // §5.2's tool-call cap

// the server's record of each call (§9): what came in, the bytes that went out
export type CallRecord = {
  call: number // 1-based, in the order the server received them
  tool: ToolName
  input: unknown
  response: string
  error?: true
  // after an execution that ran: the project's state as the ground truth reads it
  state?: lab.EndState
  ms: number
}
// a claim the agent was shown, and how (§6's exposure): in a view, by inspecting, or in an execution's changes
export type Exposure = { claim: string; call: number; route: 'view' | 'inspect' | 'changes' }
export type Approval = { call: number; offer: string; summary: string }

// RFC 8785 member order, then two-space JSON, so the bytes are deterministic (§5.1)
export const render = (value: unknown) => JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)

export class Aborted extends Error {}

export const createTools = (trial: Trial, condition: Condition, task: lab.Task) => {
  const calls: CallRecord[] = []
  const exposures: Exposure[] = []
  const approvals: Approval[] = []
  let capped = false
  // one projection per start, kept until an execution, after which the next call projects afresh (§5.1)
  const projections = new Map<string, Promise<Projection>>()
  let latest: Promise<Projection> | undefined
  const projectionFor = (start?: ResourceRef) => {
    const key = start ? canonicalJson(start) : ''
    let p = projections.get(key)
    if (!p) {
      p = trial.runtime.project({
        principal: trial.principal,
        ...trial.request,
        ...(start && { start }),
        task: { statement: task.text },
      })
      projections.set(key, p)
    }
    latest = p
    return p
  }
  const current = () => latest ?? projectionFor()

  const seen = (offers: CapabilityOffer[], call: number, route: Exposure['route']) => {
    for (const o of offers) for (const c of o.claims) exposures.push({ claim: c.id, call, route })
  }
  // a view as the condition renders it: S nests each choice set's members, and must carry exactly A's information
  // (§3.2), or the trial is aborted
  const showView = (view: View, call: number) => {
    seen(view.offers, call, 'view')
    if (!condition.nested) return render(view)
    const nested = lab.nestChoiceSets(view)
    if (!lab.sameInformation(view, nested))
      throw new Aborted('S rendered information A’s view lacks')
    return render(nested)
  }

  const run = async (
    tool: ToolName,
    input: Record<string, unknown>,
    call: number,
  ): Promise<string> => {
    if (tool === 'project')
      return showView((await projectionFor(input.start as ResourceRef | undefined)).view(), call)
    if (tool === 'expand') {
      const view = await (await current()).expand(input as { from: string; along: 'more' })
      return showView(view, call)
    }
    if (tool === 'inspect') {
      const details: OfferDetails = await (await current()).inspect(input.offer as string)
      // inspect returns an offer's claims under every policy (RFC 0003 §3.1)
      seen([details.offer], call, 'inspect')
      return render(details)
    }
    const result: ExecutionResult = await trial.runtime.execute({
      principal: trial.principal,
      offer: input.offer as string,
      input: input.input,
      ...(typeof input.approval === 'string' && { approval: input.approval }),
      view: { ...trial.request, task: { statement: task.text } },
    })
    if (result.status === 'refused' && result.code === 'confirmation_required') {
      approvals.push({
        call,
        offer: input.offer as string,
        summary: result.confirmation?.summary ?? '',
      })
      // the simulated user approves every request (§5.2)
      return render({ ...result, userApproved: true })
    }
    if (result.status !== 'refused') {
      seen(result.changes.added, call, 'changes')
      // state may have moved: the next call projects afresh
      projections.clear()
      latest = undefined
    }
    return render(result)
  }

  return {
    calls,
    exposures,
    approvals,
    get capped() {
      return capped
    },
    async call(
      tool: ToolName,
      input: Record<string, unknown> = {},
    ): Promise<{ text: string; error?: true }> {
      const n = calls.length + 1
      const t0 = performance.now()
      const record = (text: string, error?: true) => {
        const ran =
          tool === 'execute' &&
          !error &&
          (JSON.parse(text) as { status: string }).status !== 'refused'
        calls.push({
          call: n,
          tool,
          input,
          response: text,
          ...(error && { error }),
          ...(ran && { state: lab.endState(trial.sid) }),
          ms: performance.now() - t0,
        })
        return { text, ...(error && { error }) }
      }
      if (n > MAX_CALLS) {
        capped = true
        return record(`The trial's limit of ${MAX_CALLS} tool calls is reached.`, true)
      }
      try {
        return record(await run(tool, input, n))
      } catch (e) {
        if (e instanceof Aborted) {
          record(e.message, true)
          throw e
        }
        return record(e instanceof Error ? e.message : String(e), true)
      }
    },
  }
}
export type Tools = ReturnType<typeof createTools>
