import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { writeFileSync } from 'node:fs'
import type { Driver, DriverResult } from './types.ts'

// the dry run's driver (M5c): no model, a scripted agent over the real tool server, through the same MCP stdio path a
// CLI takes. It projects, follows up to five expansions, inspects what it found, and subscribes to one plan, chosen
// by the seed, approving as the user does. So every metric and trace field is produced without a model call

type Offer = { id: string; capability: string; availability: { status: string } }
type View = {
  offers: Offer[]
  // members are ids, or under S the offers themselves
  choiceSets: { members: (string | Offer)[] }[]
  omitted: { expand: { from: unknown; along: string }[] }
}
// a view's offers, with S's nested members
const offersOf = (v: View): Offer[] => [
  ...v.offers,
  ...v.choiceSets.flatMap((c) => c.members.filter((m): m is Offer => typeof m === 'object')),
]

const parse = (text: string) => JSON.parse(text) as Record<string, any>

// elicitation: whether the fake client declares MCP's elicitation, and how its person answers; by default it doesn't,
// as a client that can't ask
export const fakeDriver = (
  seed: number,
  raw: string,
  elicitation?: 'accept' | 'decline',
): Driver => ({
  id: 'fake',
  async run(trial): Promise<DriverResult> {
    const t0 = performance.now()
    if ('url' in trial.mcp) throw new Error('the fake driver takes a stdio server')
    const client = new Client(
      { name: 'fake-agent', version: '0.0.0' },
      elicitation ? { capabilities: { elicitation: {} } } : undefined,
    )
    if (elicitation)
      client.setRequestHandler(ElicitRequestSchema, async () => ({
        action: elicitation,
        content: {},
      }))
    await client.connect(
      new StdioClientTransport({
        command: trial.mcp.command,
        args: trial.mcp.args,
        stderr: 'ignore',
      }),
    )
    const trace: DriverResult['trace'] = []
    let bytes = 0
    const call = async (name: string, input: Record<string, unknown> = {}) => {
      const c0 = performance.now()
      const r = await client.callTool({ name, arguments: input })
      const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join('')
      bytes += text.length
      trace.push({ name, input, resultBytes: text.length, ms: performance.now() - c0 })
      return { text, error: r.isError === true }
    }
    let finalText = 'I looked and found nothing to subscribe to.'
    // the v0 surface's two tools (M7f): its own script, below; the four tools' is M5's, unchanged
    const listed = new Set((await client.listTools()).tools.map((t) => t.name))
    try {
      if (listed.has('affordances_open')) {
        finalText = await v0Script(seed, call)
        return finish()
      }
      if (listed.has('snapshot')) {
        finalText = await browserScript(seed, call)
        return finish()
      }
      const first = parse((await call('project')).text) as View
      const offers = offersOf(first)
      for (const e of first.omitted.expand.slice(0, 5)) {
        const r = await call('expand', { from: e.from, along: e.along })
        if (!r.error) offers.push(...offersOf(parse(r.text) as View))
      }
      const plans = [
        ...new Map(
          offers
            .filter(
              (o) =>
                o.capability === 'hosting.plan.subscribe' && o.availability.status === 'available',
            )
            .map((o) => [o.id, o]),
        ).values(),
      ]
      for (const o of plans) await call('inspect', { offer: o.id })
      const pick = plans[seed % Math.max(plans.length, 1)]
      if (pick) {
        const refused = parse((await call('execute', { offer: pick.id })).text)
        const approval = refused.confirmation?.approval
        if (approval) await call('execute', { offer: pick.id, approval })
        finalText = `I subscribed the project to ${pick.id}.`
      }
    } finally {
      await client.close()
    }
    return finish()
    function finish(): DriverResult {
      writeFileSync(raw, JSON.stringify({ trace, finalText }))
      return {
        trace,
        finalText,
        // nominal: a token per four response bytes, so the token metrics have a value to carry
        usage: { inputTokens: Math.ceil(bytes / 4), outputTokens: 20 * trace.length },
        durationMs: performance.now() - t0,
        exitCode: 0,
        cli: { name: 'fake', version: '0.0.0' },
        raw,
      }
    }
  },
})

// v0's scripted agent: it opens the home page, then the plans page, and subscribes the project to one plan it isn't
// on, chosen by the seed, resending with confirm: true as the user approves
const v0Script = async (
  seed: number,
  call: (
    name: string,
    input?: Record<string, unknown>,
  ) => Promise<{ text: string; error: boolean }>,
) => {
  await call('affordances_open', { path: '/' })
  const page = await call('affordances_open', { path: '/plans' })
  if (page.error) return 'I couldn’t open the plans page.'
  const graph = parse(page.text)
  const plans = (graph.entities.plans as { id: string; slug: string; current: boolean }[]).filter(
    (p) => !p.current,
  )
  const pick = plans[seed % Math.max(plans.length, 1)]
  if (!pick) return 'I looked and found nothing to subscribe to.'
  const subscribe = {
    path: '/plans',
    action: 'subscribe',
    input: { plan: pick.id, projectId: graph.entities.project.id },
  }
  const first = parse((await call('affordances_call', subscribe)).text)
  if (first.error?.code === 'confirm_required')
    await call('affordances_call', { ...subscribe, confirm: true })
  return `I subscribed the project to ${pick.slug}.`
}

// a snapshot's buttons whose names match, with their refs
const refOf = (snapshot: string, name: RegExp) =>
  [...snapshot.matchAll(/button "([^"]*)" \[ref=(\w+)\]/g)].filter((m) => name.test(m[1]!))

// the browser's scripted agent: it opens the plans page, presses one 'Move to' button, chosen by the seed, which loads
// the review step with that selection, and confirms there, as the user approves
const browserScript = async (
  seed: number,
  call: (
    name: string,
    input?: Record<string, unknown>,
  ) => Promise<{ text: string; error: boolean }>,
) => {
  const plans = await call('open', { path: '/plans' })
  const moves = refOf(plans.text, /^Move to (Hobby|Pro|Business)$/)
  const pick = moves[seed % Math.max(moves.length, 1)]
  if (!pick) return 'I looked and found nothing to subscribe to.'
  const review = await call('click', { ref: pick[2] })
  const confirm = refOf(review.text, /^Confirm$/)[0]
  if (!confirm) return 'The review step offered no confirmation.'
  await call('click', { ref: confirm[2] })
  return `I moved the project to ${pick[1]}.`
}
