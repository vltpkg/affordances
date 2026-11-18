import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
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

export const fakeDriver = (seed: number, raw: string): Driver => ({
  id: 'fake',
  async run(trial): Promise<DriverResult> {
    const t0 = performance.now()
    if ('url' in trial.mcp) throw new Error('the fake driver takes a stdio server')
    const client = new Client({ name: 'fake-agent', version: '0.0.0' })
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
    try {
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
  },
})
