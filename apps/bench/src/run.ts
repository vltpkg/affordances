import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createClient } from '@afford/mcp'
import { affordAgent, browserAgent, closeBrowser } from './agents.ts'
import { EFFORT, MODEL, runAgent, type RunStats } from './loop.ts'
import { newSession, tasks } from './tasks.ts'

// vlr bench -- --runs 5      every task × both agents × 5 runs, against a fresh apps/example each run
// vlr bench -- --dry         the scripted oracle instead of the model: checks the tasks and checks, costs nothing
const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    dry: { type: 'boolean', default: false },
    port: { type: 'string', default: '3100' },
  },
})
const runs = Number(values.runs)
const site = `http://localhost:${values.port}`
const example = path.join(import.meta.dirname, '../../example')

// the store keeps stock in memory, so each run gets a fresh process (build apps/example first)
const startStore = async () => {
  const store = spawn('node_modules/.bin/next', ['start', '-p', values.port!], {
    cwd: example,
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    if (
      await fetch(site).then(
        (r) => r.ok,
        () => false,
      )
    )
      return store
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  store.kill()
  throw new Error(`apps/example didn't start on ${site}; run \`vlr build\` there first`)
}

type Row = RunStats & { run: number; agent: 'browser' | 'afford'; task: string }
const rows: Row[] = []

for (let run = 1; run <= runs; run++) {
  const store = await startStore()
  try {
    for (const task of tasks)
      for (const kind of values.dry ? (['afford'] as const) : (['browser', 'afford'] as const)) {
        const sid = await newSession(site)
        const client = createClient(site, { token: sid })
        await task.setup?.(client)
        const agent = kind === 'afford' ? affordAgent(site, sid) : await browserAgent(site, sid)
        let stats: Omit<RunStats, 'success'>
        try {
          stats = values.dry
            ? {
                turns: 0,
                toolCalls: 0,
                inputTokens: 0,
                outputTokens: 0,
                ms: 0,
                stop: 'dry',
                answer: await task.oracle(client),
              }
            : await runAgent(agent.system, task.prompt, agent.tools)
        } catch (error) {
          stats = {
            turns: 0,
            toolCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            ms: 0,
            stop: 'error',
            answer: '',
            error: (error as Error).message,
          }
        } finally {
          await agent.close()
        }
        const success = !stats.error && (await task.check(client, stats.answer))
        rows.push({ run, agent: kind, task: task.id, ...stats, success })
        console.log(
          `run ${run}  ${kind.padEnd(7)}  ${task.id.padEnd(16)}  ${success ? 'pass' : 'FAIL'}  ${stats.turns} turns  ${stats.inputTokens + stats.outputTokens} tokens  ${stats.ms}ms`,
        )
      }
  } finally {
    store.kill()
  }
}
await closeBrowser()

const median = (xs: number[]) => {
  const s = xs.toSorted((a, b) => a - b)
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0
}
const summary = Object.fromEntries(
  (['browser', 'afford'] as const).map((agent) => {
    const mine = rows.filter((row) => row.agent === agent)
    return [
      agent,
      {
        successRate: mine.length ? mine.filter((r) => r.success).length / mine.length : 0,
        medianTurns: median(mine.map((r) => r.turns)),
        medianTokens: median(mine.map((r) => r.inputTokens + r.outputTokens)),
        medianMs: median(mine.map((r) => r.ms)),
      },
    ]
  }),
)

if (values.dry) {
  const failed = rows.filter((r) => !r.success)
  if (failed.length) throw new Error(`oracle failed: ${failed.map((r) => r.task).join(', ')}`)
  console.log('dry run: every oracle passes its check')
} else {
  const out = path.join(
    import.meta.dirname,
    '../results',
    `${new Date().toISOString().slice(0, 10)}.json`,
  )
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(
    out,
    `${JSON.stringify({ model: MODEL, effort: EFFORT, runs, tasks: tasks.map(({ id, prompt }) => ({ id, prompt })), summary, rows }, null, 2)}\n`,
  )
  console.log(JSON.stringify(summary, null, 2), `\n→ ${path.relative(process.cwd(), out)}`)
}
