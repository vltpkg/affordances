import * as lab from '@affordances/hosting-lab/trial'
import { createServer } from '@affordances/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { conditions } from '../src/conditions.ts'
import { intendedEndState } from '../src/intended.ts'
import { createTools } from '../src/tools.ts'
import { setupTrial } from '../src/trial.ts'
import type { V0Call, V0Record } from '../src/v0-server.ts'
import { capabilityOf, v0RequestsOf, type V0Trial } from '../src/v0.ts'

// the v0 surface (surfaces/PLAN.md §3, §5): packages/mcp's own tools, unchanged, with the harness only listening; and
// its request events, replayed as the capabilities they're bound to

const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-v0-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
// nothing listens here: tools/list needs no site, and a call fails as v0's client fails
const SITE = 'http://127.0.0.1:9'

test('the recording server lists exactly packages/mcp’s tools, and records each call with its result', async () => {
  const out = path.join(dir, 'v0.json')
  const config = path.join(dir, 'v0-config.json')
  writeFileSync(config, JSON.stringify({ url: SITE, session: 's_v0', out }))
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(import.meta.dirname, '..', 'src', 'v0-server.ts'), config],
    }),
  )
  const recorded = await client.listTools()
  // the same tools, in process, straight from createServer
  const direct = new Client({ name: 'test', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer(SITE, { token: 's_v0' }).connect(a)
  await direct.connect(b)
  expect(JSON.stringify(recorded)).toBe(JSON.stringify(await direct.listTools()))
  // and no instructions, as on every surface
  expect(client.getInstructions()).toBeUndefined()
  const result = (await client.callTool({
    name: 'affordances_open',
    arguments: { path: '/' },
  })) as {
    isError?: boolean
  }
  expect(result.isError).toBe(true)
  await client.close()
  await direct.close()
  const record = JSON.parse(readFileSync(out, 'utf8')) as V0Record
  expect(record.toolLists).toEqual([recorded.tools])
  expect(record.calls).toMatchObject([
    { tool: 'affordances_open', input: { path: '/' }, isError: true },
  ])
})

const call = (input: Record<string, unknown>, output: unknown, isError = false): V0Call => ({
  tool: 'affordances_call',
  input,
  output,
  isError,
  at: 0,
  ms: 0,
})

test('v0’s request events: a call that asked for confirmation or ran, as its bound capability, each once', () => {
  expect(capabilityOf('/plans', 'subscribe')).toBe('hosting.plan.subscribe')
  const subscribe = { path: '/plans', action: 'subscribe', input: { plan: 'p2', projectId: 'j1' } }
  const requests = v0RequestsOf({
    calls: [
      {
        tool: 'affordances_open',
        input: { path: '/plans' },
        output: {},
        isError: false,
        at: 0,
        ms: 0,
      },
      call(subscribe, { ok: false, error: { code: 'confirm_required', message: 'Subscribe?' } }),
      call({ ...subscribe, confirm: true }, { ok: true }),
      // refused for another reason, or a tool error: not a request
      call(
        { path: '/add-ons', action: 'addAddOn', input: { addOn: 'x' } },
        { ok: false, error: { code: 'invalid_input' } },
      ),
      call({ path: '/add-ons', action: 'addAddOn', input: { addOn: 'y' } }, 'fetch failed', true),
    ],
  })
  expect(requests).toEqual([
    { capability: 'hosting.plan.subscribe', input: { plan: 'p2', projectId: 'j1' } },
  ])
  // a call that ran, but that the table doesn't know, is the harness's fault
  expect(() =>
    v0RequestsOf({ calls: [call({ path: '/plans', action: 'nothing' }, { ok: true })] }),
  ).toThrow(/no capability is bound to it/)
})

test('a v0 purchase replays to the same intended end state as the same purchase through protocol 1', async () => {
  const condition = conditions.A
  for (const index of [0, 1, 4]) {
    const trial = await setupTrial(condition, index, 'T6')
    // through protocol 1, in process: refused for confirmation, then approved
    const tools = createTools(
      trial,
      condition,
      lab.tasks.find((t) => t.id === 'T6')!,
    )
    const projection = await trial.runtime.project({ principal: trial.principal, ...trial.request })
    const offer = projection.offers.find(
      (o) => o.capability === 'hosting.plan.subscribe' && o.target?.key === trial.plans[1],
    )!.id
    const input = { plan: trial.plans[1], projectId: trial.project.key }
    const first = JSON.parse((await tools.call('execute', { offer, input })).text)
    await tools.call('execute', { offer, input, approval: first.confirmation.approval })
    const protocol1 = lab.endState(trial.sid)
    // the same purchase as v0 calls, replayed on a fresh store
    const v0: V0Trial = {
      surface: 'v0',
      url: SITE,
      toolLists: [],
      condition: 'A',
      index,
      task: 'T6',
      project: trial.project.key,
      calls: [
        call(
          { path: '/plans', action: 'subscribe', input },
          { ok: false, error: { code: 'confirm_required' } },
        ),
        call({ path: '/plans', action: 'subscribe', input, confirm: true }, { ok: true }),
      ],
    }
    const file = path.join(dir, `v0-trial-${index}.json`)
    writeFileSync(file, JSON.stringify(v0))
    const intended = await intendedEndState(file)
    expect(protocol1).toMatchObject({ plan: 'pro' })
    expect(intended.state).toEqual(protocol1)
    expect(intended.replayed).toEqual([offer])
  }
})
