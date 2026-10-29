import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { LIVE_MODELS, LIVE_PAIRINGS } from '@/lib/live'

const repo = path.join(process.cwd(), '../..')
const bench = path.join(repo, 'apps/bench')
const env = path.join(bench, '.env')

// one race at a time: each starts its own store on the same port
let running: ChildProcess | undefined

const fail = (status: number, error: string) => Response.json({ error }, { status })

const hasKey = () =>
  Boolean(process.env.ANTHROPIC_API_KEY) ||
  (existsSync(env) && /^ANTHROPIC_API_KEY=\S+/m.test(readFileSync(env, 'utf8')))

// the recorder's stdout is NDJSON DemoEvents; it's passed through as is, plus one {type:'error'} line if the
// recorder dies before its `end`
export const POST = async (request: Request) => {
  const { task, model, agents } = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  const pairing = LIVE_PAIRINGS.find((p) => p.agents === agents)
  if (!pairing) return fail(400, `Unknown agents: ${String(agents)}`)
  if (!(pairing.tasks as readonly unknown[]).includes(task))
    return fail(400, `Unknown task for ${pairing.agents}: ${String(task)}`)
  if (!LIVE_MODELS.includes(model as string)) return fail(400, `Unknown model: ${String(model)}`)
  if (running) return fail(409, 'A live race is already running. Wait for it to finish.')
  if (!hasKey()) return fail(400, 'No ANTHROPIC_API_KEY. Add it to apps/bench/.env.')
  if (!existsSync(path.join(repo, 'apps/example/.next/BUILD_ID')))
    return fail(400, 'apps/example isn’t built. Run `vlr build` in apps/example first.')

  const child = spawn(
    process.execPath,
    [
      `--env-file-if-exists=${env}`,
      path.join(bench, 'src/record.ts'),
      '--task',
      task as string,
      '--model',
      model as string,
      '--agents',
      pairing.agents,
      '--stream',
      '--port',
      '3102',
    ],
    // its own process group, so stopping it also stops the store and chromium it started
    { cwd: bench, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  running = child
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk).slice(-4000)))
  const stop = () => {
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }
  request.signal.addEventListener('abort', stop)

  const encoder = new TextEncoder()
  let open = true
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on('data', (chunk: Buffer) => open && controller.enqueue(new Uint8Array(chunk)))
      child.on('close', (code) => {
        if (running === child) running = undefined
        if (!open) return
        if (code !== 0) {
          // node prints the thrown error under its stack; the message line is what a person needs
          const message =
            stderr.match(/^\w*Error: (.+)$/m)?.[1] ??
            (stderr.trim().split('\n').slice(-3).join(' ') || `The recorder exited with ${code}`)
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message })}\n`))
        }
        controller.close()
      })
    },
    cancel: () => {
      open = false
      stop()
    },
  })
  return new Response(body, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  })
}
