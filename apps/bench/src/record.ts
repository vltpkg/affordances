import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { createClient } from '@affordances/mcp'
import { affordAgent, browserAgent, closeBrowser, visionAgent, webmcpAgent } from './agents.ts'
import type { AgentKind, DemoEvent } from './events.ts'
import { DEFAULT_MODEL, runAgent, type LoopEvent } from './loop.ts'
import { startStore } from './store.ts'
import { newSession, tasks as allTasks } from './tasks.ts'

// vlr record -- --task add-to-cart          both agents race one task on a fresh store; saved for apps/demo
// vlr record -- --task all                  every task, one recording each
// vlr record -- --task checkout --stream    events as JSON lines on stdout as they happen (apps/demo's live mode)
// vlr record -- --agents browser,webmcp     the discovery story: the same browser agent, with and without WebMCP
const { values } = parseArgs({
  options: {
    task: { type: 'string', default: 'add-to-cart' },
    // which two (or more) race: browser, afford, webmcp, vision
    agents: { type: 'string', default: 'browser,afford' },
    model: { type: 'string', default: DEFAULT_MODEL },
    port: { type: 'string', default: '3101' },
    stream: { type: 'boolean', default: false },
    out: { type: 'string', default: path.join(import.meta.dirname, '../../demo/recordings') },
  },
})
const model = values.model!
const site = `http://localhost:${values.port}`
const make = {
  browser: browserAgent,
  afford: affordAgent,
  webmcp: webmcpAgent,
  vision: visionAgent,
}
const kinds = values.agents!.split(',').map((k) => k.trim()) as AgentKind[]
if (kinds.some((k) => !(k in make)))
  throw new Error('--agents takes browser, afford, webmcp, vision')
const tasks = values.task === 'all' ? allTasks : allTasks.filter((t) => t.id === values.task)
if (!tasks.length)
  throw new Error(`unknown --task; known: all, ${allTasks.map((t) => t.id).join(', ')}`)

// what a person would see, kept small: frames ride along in the recording as data urls
const VIEWPORT = { width: 1280, height: 800 }
const shoot = async (page: import('playwright').Page) =>
  `data:image/jpeg;base64,${(await page.screenshot({ type: 'jpeg', quality: 55 })).toString('base64')}`

const record = async (task: (typeof tasks)[number]) => {
  const store = await startStore(values.port!)
  const events: DemoEvent[] = []
  const started = performance.now()
  const at = () => Math.round(performance.now() - started)
  const emit = (event: DemoEvent) => {
    events.push(event)
    if (values.stream) process.stdout.write(`${JSON.stringify(event)}\n`)
  }
  const id = `${new Date().toISOString().slice(0, 16).replace(':', '')}-${task.id}-${model}${kinds.includes('webmcp') ? '-webmcp' : ''}`
  emit({
    type: 'run',
    id,
    task: { id: task.id, prompt: task.prompt },
    model,
    startedAt: new Date().toISOString(),
  })

  // the afford agent never renders anything; a separate page on its session shows the audience the store
  const observer = await chromium.launch()
  try {
    const race = kinds.map(async (kind) => {
      const sid = await newSession(site)
      const client = createClient(site, { token: sid })
      await task.setup?.(client)
      const agent = await make[kind](site, sid)
      emit({
        type: 'agent',
        agent: kind,
        system: agent.system,
        tools: (typeof agent.tools === 'function' ? await agent.tools() : agent.tools).map(
          ({ name, description = '' }) => ({ name, description }),
        ),
      })

      // the page frames come from: the agent's own browser, or the observer on the same session
      const page =
        'page' in agent
          ? agent.page
          : await (async () => {
              const context = await observer.newContext({ baseURL: site, viewport: VIEWPORT })
              await context.addCookies([{ name: 'sid', value: sid, url: site }])
              return context.newPage()
            })()
      if ('page' in agent) await agent.page.setViewportSize(VIEWPORT)
      let current = '/'
      // one frame at a time per agent, off the agent's clock: the loop doesn't wait for screenshots
      let frames = Promise.resolve()
      const frame = (toolId: string, result: string, input: Record<string, unknown>) =>
        (frames = frames.then(async () => {
          try {
            if (kind === 'afford') {
              const redirect = (JSON.parse(result) as { redirect?: string }).redirect
              current = redirect ?? (input.path as string) ?? current
              await page.goto(current, { waitUntil: 'networkidle' })
            }
            emit({
              type: 'frame',
              agent: kind,
              at: at(),
              id: toolId,
              url: page.url(),
              image: await shoot(page),
            })
          } catch {
            // a frame is a nicety; a failed one never fails the run
          }
        }))

      const onEvent = (e: LoopEvent) => {
        if (e.type === 'turn') emit({ ...e, agent: kind, at: at() })
        else {
          emit({ ...e, agent: kind, at: at() })
          if (!e.error) frame(e.id, e.result, e.input as Record<string, unknown>)
        }
      }
      try {
        const stats = await runAgent(model, agent.system, task.prompt, agent.tools, onEvent)
        await frames
        const success = await task.check(client, stats.answer)
        emit({
          type: 'done',
          agent: kind,
          at: at(),
          success,
          answer: stats.answer,
          stop: stats.stop,
          turns: stats.turns,
          toolCalls: stats.toolCalls,
          tokens: stats.tokens,
          costUsd: stats.costUsd,
        })
      } catch (error) {
        emit({
          type: 'done',
          agent: kind,
          at: at(),
          success: false,
          answer: '',
          stop: 'error',
          turns: 0,
          toolCalls: 0,
          tokens: 0,
          costUsd: 0,
          error: (error as Error).message,
        })
      } finally {
        await agent.close()
      }
    })
    await Promise.all(race)
    emit({ type: 'end', at: at() })
  } finally {
    await observer.close()
    store.kill()
  }
  return { id, events }
}

for (const task of tasks) {
  const { id, events } = await record(task)
  if (!values.stream) {
    mkdirSync(values.out!, { recursive: true })
    const file = path.join(values.out!, `${id}.json`)
    writeFileSync(file, `${JSON.stringify({ events })}\n`)
    const done = events.filter((e) => e.type === 'done')
    console.log(
      `${task.id}: ${done.map((d) => `${d.agent} ${d.success ? 'pass' : 'FAIL'} ${d.turns} turns`).join(', ')} → ${path.relative(process.cwd(), file)}`,
    )
  }
}
await closeBrowser()
