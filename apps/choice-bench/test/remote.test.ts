import * as lab from '@affordances/hosting-lab/trial'
import * as serve from '@affordances/hosting-lab/serve'
import { expect, test } from 'vitest'
import { remoteRuntime } from '../src/remote.ts'
import { surfaces } from '../src/surfaces.ts'
import { createTools } from '../src/tools.ts'
import { setupTrial } from '../src/trial.ts'

// M7f's full and progressive surfaces: the benchmark's four tools, unchanged, with a protocol-1 client behind them
// (src/remote.ts) in place of the in-process runtime. The same calls through both give the same bytes, call by call,
// so moving them onto the shared server changes nothing the agent sees. Here the client's fetch reaches hosting-lab's
// own protocol-1 route in process, over the same store; the real server is the harness's next step

const T3 = lab.tasks.find((t) => t.id === 'T3')!
const route = (url: string, init?: RequestInit) => {
  const request = new Request(`https://hosting.test${url}`, init)
  return request.method === 'POST' ? serve.POST(request) : serve.GET(request)
}

// an approval token masked, since each runtime signs its own
const masked = (t: string[]) => t.map((s) => s.replace(/"approval": "[^"]+"/g, '"approval": "…"'))

test.each(['full', 'progressive'] as const)(
  '%s: every tool response through the server’s protocol 1 equals the in-process one',
  async (id) => {
    const surface = surfaces[id]
    const run = async (remote: boolean) => {
      const trial = await setupTrial(surface.condition!, 0, 'T3')
      const tools = createTools(
        remote
          ? {
              ...trial,
              runtime: remoteRuntime({ base: '/api/projection', session: trial.sid, fetch: route }),
            }
          : trial,
        surface.condition!,
        T3,
      )
      const texts: string[] = []
      const call = async (
        name: Parameters<typeof tools.call>[0],
        input: Record<string, unknown> = {},
      ) => {
        const r = await tools.call(name, input)
        texts.push(r.text)
        return JSON.parse(r.text) as Record<string, any>
      }
      const view = await call('project')
      const subscribe = view.offers.find(
        (o: { capability: string }) => o.capability === 'hosting.plan.subscribe',
      )
      for (const e of view.omitted.expand.slice(0, 3))
        await call('expand', { from: e.from, along: e.along })
      await call('inspect', { offer: subscribe.id })
      const refused = await call('execute', {
        offer: subscribe.id,
        input: { plan: subscribe.target.key, projectId: trial.project.key },
      })
      await call('execute', {
        offer: subscribe.id,
        input: { plan: subscribe.target.key, projectId: trial.project.key },
        approval: refused.confirmation?.approval,
      })
      // each trial's account gets a fresh random project id, and the revisions digest it: those are masked, so what's
      // compared is everything the agent sees beyond the trial's own identity
      const mask = (s: string) =>
        s.replaceAll(trial.project.key, 'PROJECT').replace(/sha256-[A-Za-z0-9_-]+/g, 'sha256-…')
      return { texts: texts.map(mask), calls: tools.calls.map((c) => [c.tool, c.state ?? null]) }
    }
    const local = await run(false)
    const remote = await run(true)
    // the approval tokens differ, since each runtime signs its own; everything else is the same bytes
    expect(masked(remote.texts)).toEqual(masked(local.texts))
    expect(remote.calls).toEqual(local.calls)
    // project, the expansions there are (none under exhaustive), inspect, and the two executes
    expect(local.texts.length).toBeGreaterThanOrEqual(4)
  },
)
