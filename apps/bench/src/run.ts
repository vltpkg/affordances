import { execSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createClient } from '@afford/mcp'
import { affordAgent, browserAgent, closeBrowser } from './agents.ts'
import { DEFAULT_MODEL, EFFORT, emptyStats, runAgent, type RunStats } from './loop.ts'
import { newSession, tasks as allTasks } from './tasks.ts'

// vlr bench -- --runs 20                            every task × both agents × 20 runs, a fresh apps/example each run
// vlr bench -- --runs 20 --model claude-haiku-5-5   the same, on another model
// vlr bench -- --dry                                the scripted oracle instead of the model: checks the tasks, free
// vlr bench -- --runs 5 --tasks search              one task only, to check a change cheaply (its own results file)
const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    model: { type: 'string', default: DEFAULT_MODEL },
    dry: { type: 'boolean', default: false },
    // a comma-separated subset, to check one change cheaply; the results file says which ran
    tasks: { type: 'string' },
    port: { type: 'string', default: '3100' },
  },
})
const runs = Number(values.runs)
const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' }).trim()
const model = values.model!
const wanted = values.tasks?.split(',').map((t) => t.trim())
const tasks = wanted ? allTasks.filter((t) => wanted.includes(t.id)) : allTasks
if (wanted && tasks.length !== wanted.length)
  throw new Error(`unknown task in --tasks; known: ${allTasks.map((t) => t.id).join(', ')}`)
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
        const agent =
          kind === 'afford' ? await affordAgent(site, sid) : await browserAgent(site, sid)
        let stats: Omit<RunStats, 'success'>
        try {
          stats = values.dry
            ? emptyStats({ stop: 'dry', answer: await task.oracle(client) })
            : await runAgent(model, agent.system, task.prompt, agent.tools)
        } catch (error) {
          stats = emptyStats({ stop: 'error', error: (error as Error).message })
        } finally {
          await agent.close()
        }
        const success = !stats.error && (await task.check(client, stats.answer))
        rows.push({ run, agent: kind, task: task.id, ...stats, success })
        console.log(
          `run ${run}  ${kind.padEnd(7)}  ${task.id.padEnd(16)}  ${success ? 'pass' : 'FAIL'}  ${stats.turns} turns  ${stats.tokens} tokens  $${stats.costUsd.toFixed(4)}  ${stats.ms}ms`,
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
// median plus the full range, so a reader sees the spread and not only the middle
const spread = (xs: number[]) => ({
  median: median(xs),
  min: xs.length ? Math.min(...xs) : 0,
  max: xs.length ? Math.max(...xs) : 0,
})
const summarize = (mine: Row[]) => {
  const passed = mine.filter((r) => r.success)
  const cost = mine.reduce((sum, r) => sum + r.costUsd, 0)
  return {
    // the four the site reads; medians across every run
    successRate: mine.length ? passed.length / mine.length : 0,
    medianTurns: median(mine.map((r) => r.turns)),
    medianTokens: median(mine.map((r) => r.tokens)),
    medianMs: median(mine.map((r) => r.ms)),
    turns: spread(mine.map((r) => r.turns)),
    tokens: spread(mine.map((r) => r.tokens)),
    ms: spread(mine.map((r) => r.ms)),
    firstActionMs: spread(mine.flatMap((r) => (r.firstActionMs === null ? [] : [r.firstActionMs]))),
    tokenSplit: {
      input: median(mine.map((r) => r.inputTokens)),
      cacheRead: median(mine.map((r) => r.cacheReadTokens)),
      cacheWrite: median(mine.map((r) => r.cacheWriteTokens)),
      output: median(mine.map((r) => r.outputTokens)),
    },
    // what reading pages costs: bytes the agent's read tools returned, per run
    readBytes: spread(
      mine.map((r) =>
        r.trace
          .filter((c) => !['afford_call', 'click', 'fill', 'press'].includes(c.tool))
          .reduce((sum, c) => sum + c.bytes, 0),
      ),
    ),
    costUsd: cost,
    costPerSuccessUsd: passed.length ? cost / passed.length : null,
  }
}
const agents = values.dry ? (['afford'] as const) : (['browser', 'afford'] as const)
const summary = Object.fromEntries(
  agents.map((agent) => [agent, summarize(rows.filter((row) => row.agent === agent))]),
)
const perTask = Object.fromEntries(
  tasks.map((task) => [
    task.id,
    Object.fromEntries(
      agents.map((agent) => [
        agent,
        summarize(rows.filter((r) => r.agent === agent && r.task === task.id)),
      ]),
    ),
  ]),
)

if (values.dry) {
  const failed = rows.filter((r) => !r.success)
  if (failed.length) throw new Error(`oracle failed: ${failed.map((r) => r.task).join(', ')}`)
  console.log('dry run: every oracle passes its check')
} else {
  const out = path.join(
    import.meta.dirname,
    '../results',
    // a partial run gets its own name, so it never stands in for a full sweep
    `${new Date().toISOString().slice(0, 16).replace(':', '')}-${model}${wanted ? `-${tasks.map((t) => t.id).join('+')}` : ''}.json`,
  )
  // enough to reproduce: the code (and whether it had uncommitted changes), the model, and when
  const commit = {
    sha: git('rev-parse HEAD'),
    dirty: git("status --porcelain -- apps packages ':!apps/bench/results'") !== '',
  }
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(
    out,
    `${JSON.stringify({ model, effort: EFFORT, runs, ...(wanted && { partial: true }), commit, finishedAt: new Date().toISOString(), node: process.version, tasks: tasks.map(({ id, prompt }) => ({ id, prompt })), summary, perTask, rows }, null, 2)}\n`,
  )
  console.log(JSON.stringify(summary, null, 2), `\n→ ${path.relative(process.cwd(), out)}`)
}
