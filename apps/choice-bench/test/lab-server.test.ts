import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { crossCheck, readEndState, startLabServer } from '../src/lab-server.ts'
import { remoteRuntime } from '../src/remote.ts'

// a surface trial's server, for real: it needs hosting-lab's production build, so it runs where one is given
// (HOSTING_LAB_BUILD, the pinned export's apps/hosting-lab), as the real-path check does, and is skipped elsewhere.
// It also measures the start, for the planner: the median and the maximum of several starts

const dir = process.env.HOSTING_LAB_BUILD
const PORT = 3911
type View = {
  offers: { id: string; capability: string; target?: { key: string }; claims: { id: string }[] }[]
}

test.skipIf(!dir)(
  'a fresh server per trial: ready, configured by env, the same build, its state file cross-checked, stopped by PID',
  async () => {
    const starts: number[] = []
    const builds = new Set<string>()
    const orders: [string, string, string][] = [
      ['p2', 'p1', 'p3'],
      ['p3', 'p2', 'p1'],
      ['p1', 'p2', 'p3'],
    ]
    for (const [i, plans] of orders.entries()) {
      const session = `s_lab_${i}`
      const trialDir = mkdtempSync(path.join(tmpdir(), 'lab-server-'))
      const stateFile = path.join(trialDir, 'state.json')
      const server = await startLabServer({
        dir: dir!,
        port: PORT,
        plans,
        session,
        task: 'T6',
        stateFile,
      })
      try {
        starts.push(server.startMs)
        builds.add(server.buildId)
        // the trial's own session sees its account, through protocol 1, with T6's claim edit
        const rt = remoteRuntime({ base: `${server.url}/api/projection`, session })
        const view = (
          await rt.project({ principal: {} as never, policy: 'exhaustive' })
        ).view() as unknown as View
        const subscribe = view.offers.filter((o) => o.capability === 'hosting.plan.subscribe')
        expect(subscribe.map((o) => o.target!.key).toSorted()).toEqual(['p1', 'p2', 'p3'])
        expect(view.offers.flatMap((o) => o.claims.map((c) => c.id))).toContain(
          'businessRecommended',
        )
        // a purchase through protocol 1: refused for confirmation, then approved with its token. The catalog's
        // second plan, Pro, has the order's second id
        const pro = subscribe.find((o) => o.target!.key === plans[1])!
        const project = view.offers.find((o) => o.capability === 'hosting.project.read')!.target!
          .key
        const call = {
          principal: {} as never,
          offer: pro.id,
          input: { plan: plans[1], projectId: project },
        }
        const refused = (await rt.execute(call as never)) as { confirmation: { approval: string } }
        await rt.execute({ ...call, approval: refused.confirmation.approval } as never)
        // the state file is M5's ground truth, and project.read through the session agrees with it
        const state = readEndState(stateFile, session)
        expect(state).toMatchObject({ plan: 'pro', bundle: null })
        expect(await crossCheck(server.url, session, state)).toMatchObject({ plan: 'pro' })
        // and a state that disagrees is a harness fault, never scored
        await expect(crossCheck(server.url, session, { ...state!, plan: 'hobby' })).rejects.toThrow(
          /harness fault \(cross-check\)/,
        )
      } finally {
        await server.stop()
        rmSync(trialDir, { recursive: true, force: true })
      }
      // stopped: the port answers nothing
      await expect(fetch(`http://127.0.0.1:${PORT}/.well-known/affordances.json`)).rejects.toThrow(
        'fetch failed',
      )
    }
    expect(builds.size).toBe(1)
    const sorted = starts.toSorted((a, b) => a - b)
    console.log(
      `START_MS median=${Math.round(sorted[1]!)} max=${Math.round(sorted.at(-1)!)} all=${starts.map(Math.round).join(',')}`,
    )
  },
  300_000,
)
