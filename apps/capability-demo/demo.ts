// One capability, hosting-lab's plan.subscribe, through four transports: v0, version 1 over HTTP, MCP (mcp-v1,
// generic) and WebMCP. Each one shows the plan comparison an agent gets, asks to move the project to Pro, and is
// refused for confirmation. The person then confirms in the app's own review page, and the store is read back. No
// transport hands an agent a way to approve: v0 would take the agent's own `confirm: true` resend, which isn't the
// person's approval (RFC 0004 §2), so the demo doesn't send it.
//
//   node apps/capability-demo/demo.ts [--headed] [--interactive]
//
// --headed shows the person's browser; --interactive waits for a real click on Confirm (implies --headed).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const LAB = path.join(ROOT, 'apps/hosting-lab')
const args = new Set(process.argv.slice(2))
const interactive = args.has('--interactive')
const headed = interactive || args.has('--headed')

const PRO = 'pro'
let failures = 0
const step = (text: string) => console.log(`\n  ${text}`)
const evidence = (label: string, value: unknown) =>
  console.log(`    ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
const check = (ok: boolean, text: string) => {
  if (!ok) failures++
  console.log(`    ${ok ? 'ok' : 'FAILED'}: ${text}`)
}

// ---- what has to exist first: the workspace's build, hosting-lab's production build, and Chromium ----

const built = [
  'packages/ir/dist/index.js',
  'packages/runtime/dist/agent.js',
  'packages/mcp/dist/index.js',
  'packages/mcp-v1/dist/index.js',
  'packages/webmcp/dist/index.js',
  'apps/hosting-lab/.next/BUILD_ID',
]
if (built.some((f) => !existsSync(path.join(ROOT, f)))) {
  console.log('Building the workspace first (vlt run build, at the repo root), once.')
  const build = spawnSync('vlt', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (build.error || build.status !== 0) {
    console.error(
      'The build failed. Run `vlt install` and then `vlt run build` at the repo root, and try again.',
    )
    process.exit(1)
  }
}

const { chromium } = await import('playwright')
if (!existsSync(chromium.executablePath())) {
  console.error(
    "Playwright's Chromium isn't installed, and the demo won't download it. Run this once, then try again:\n\n" +
      '  cd apps/capability-demo && npx playwright install chromium\n',
  )
  process.exit(1)
}

const { createClient } = await import('@affordances/mcp')
const { createMcpServer } = await import('@affordances/mcp-v1')
const { httpAdapter, TOKEN } = await import('@affordances/runtime/agent')
const { manifest } = await import('@affordances/hosting-lab/manifest')
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')

// ---- hosting-lab, from its production build, on a free port ----

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
const port = await freePort()
const base = `http://localhost:${port}`
const lab: ChildProcess = spawn(
  path.join(LAB, 'node_modules/.bin/next'),
  ['start', '-p', String(port)],
  {
    cwd: LAB,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'ignore',
    detached: true,
  },
)
const stopLab = () => {
  try {
    if (lab.pid) process.kill(-lab.pid)
  } catch {
    // already gone
  }
}
process.on('exit', stopLab)
process.on('SIGINT', () => process.exit(130))
for (let i = 0; ; i++) {
  if (lab.exitCode !== null) throw new Error(`hosting-lab exited early (${lab.exitCode})`)
  const up = await fetch(`${base}/`).then(
    (r) => r.ok,
    () => false,
  )
  if (up) break
  if (i > 240) throw new Error('hosting-lab did not start within a minute')
  await new Promise((r) => setTimeout(r, 250))
}
console.log(`hosting-lab is serving its production build at ${base}`)

// ---- the person: one browser, with WebMCP's flag, and a fresh session per transport so each starts on Hobby ----

const browser = await chromium.launch({ headless: !headed, args: ['--enable-features=WebMCP'] })
const sessionFor = async () => {
  const context = await browser.newContext()
  const page = await context.newPage()
  // the first page load sets the session cookie, and makes the session's account and project
  await page.goto(`${base}/plans`)
  const sid = (await context.cookies()).find((c) => c.name === 'sid')?.value
  if (!sid) throw new Error('hosting-lab set no session cookie')
  // an agent outside the browser authenticates as the same session with its bearer token
  const fetcher = ((url: string | URL | Request, init?: RequestInit) =>
    fetch(url, {
      ...init,
      headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${sid}` },
    })) as typeof fetch
  return { context, page, sid, fetcher }
}
type Session = Awaited<ReturnType<typeof sessionFor>>

type View = {
  offers: { id: string; target?: { type: string; key: string } }[]
  choiceSets: {
    id: string
    members: string[]
    comparison: {
      differ: string[]
      rows: Record<string, unknown>[]
      shared: Record<string, unknown>
    }
  }[]
}
type Refusal = {
  status: string
  code?: string
  confirmation?: { summary: string; approval?: string }
}

const projectOf = (view: View) => {
  const read = view.offers.find((o) => o.id.startsWith('hosting.project.read@hosting.project:'))
  if (!read)
    throw new Error("the view has no project.read offer, so the session's project isn't known")
  return read.id.split(':').slice(1).join(':')
}
const proOffer = (view: View) => {
  const set = view.choiceSets.find((s) => s.id === 'hosting.plan.subscribe@hosting.plan')
  // a row has no key (the member's offer id carries it), and rows are in the members' order
  const at = set?.comparison.rows.findIndex((r) => r.slug === PRO) ?? -1
  const id = at >= 0 ? set?.members[at] : undefined
  return { set, member: id === undefined ? undefined : view.offers.find((o) => o.id === id) }
}

// the comparison an agent gets, as a table: the plan choice set's members, side by side (RFC 0002 §6.6)
const table = (rows: Record<string, unknown>[], columns: string[]) => {
  const cells = rows.map((r) => columns.map((c) => String(r[c] ?? '')))
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i]!.length)))
  const line = (xs: string[]) => `      ${xs.map((x, i) => x.padEnd(widths[i]!)).join('  ')}`
  console.log(line(columns))
  for (const r of cells) console.log(line(r))
}
const showComparison = (view: View) => {
  const { set } = proOffer(view)
  if (!set) return check(false, 'the view carries the plan choice set')
  step('The comparison the agent is shown (the plan choice set, RFC 0002 §6.6):')
  table(set.comparison.rows, ['name', ...set.comparison.differ.filter((c) => c !== 'name')])
}

// the person, in the app: open the review page for the call, read the summary, and confirm
const personConfirms = async (session: Session, review: string, summary: string) => {
  step(`The person opens the review page: ${review}`)
  const page = session.page
  await page.goto(`${base}${review}`)
  const element = page.locator('[data-confirmation-summary]')
  if ((await element.count()) === 0) {
    const said = (await page.locator('body').textContent())?.trim().slice(0, 200)
    check(false, `the review page shows a confirmation summary (it shows: ${said})`)
    return false
  }
  const shown = (await element.textContent())?.trim() ?? ''
  evidence('the page shows', shown)
  check(shown === summary, "the page's summary is the refusal's, byte for byte")
  if (interactive) {
    console.log('    Waiting for you to click Confirm in the browser window…')
  } else {
    await page.locator('[data-confirm]').click()
    evidence('the person', 'clicked Confirm (scripted; --interactive waits for a real click)')
  }
  await page.waitForURL((u) => !u.pathname.startsWith('/review'), {
    timeout: interactive ? 600_000 : 15_000,
  })
  check(
    (await page.locator('[data-not-confirmed]').count()) === 0,
    'the page reports no refusal after Confirm',
  )
  return true
}

// the store, read back through protocol 1: hosting.project.read's output
const readBack = async (session: Session, project: string) => {
  const result = (await (
    await session.fetcher(`${base}/api/projection/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offer: `hosting.project.read@hosting.project:${project}`,
        input: { projectId: project },
      }),
    })
  ).json()) as { status: string; output?: { plan?: string } }
  evidence('the store reads back', { status: result.status, plan: result.output?.plan })
  check(result.output?.plan === PRO, 'the project is on Pro')
}

const reviewPath = (plan: string, project: string) =>
  `/review?${new URLSearchParams({ action: 'subscribe', plan, projectId: project })}`
const noToken = (text: string, where: string) =>
  check(!new RegExp(TOKEN.source).test(text), `no approval token in what ${where} returned`)

// ---- 1. v0: the page graph, and its confirm resend that the demo doesn't send ----

const v0 = async () => {
  console.log('\n1. v0, the page graph (@affordances/mcp)')
  const session = await sessionFor()
  const client = createClient(base, { token: session.sid })
  // the page's entities, as hosting-lab's /plans page graph declares them
  const graph = (await client.open('/plans')) as unknown as {
    entities: { project: { id: string }; plans: Record<string, unknown>[] }
  }
  const project = graph.entities.project.id
  step('What the /plans page graph shows the agent (its plan entities):')
  table(graph.entities.plans, [
    'name',
    'priceUsd',
    'bandwidthGb',
    'buildMinutes',
    'rollback',
    'support',
  ])
  const pro = graph.entities.plans.find((p) => p.slug === PRO)!.id as string
  step('The agent calls subscribe for Pro, without confirm:')
  const delta = (await client.call('/plans', 'subscribe', { plan: pro, projectId: project })) as {
    ok: boolean
    error?: { code: string; message: string }
  }
  evidence('v0 answers', delta)
  check(!delta.ok && delta.error?.code === 'confirm_required', 'v0 refuses for confirmation')
  console.log(
    "    v0 would run it on the agent's own `confirm: true` resend, which isn't the person's approval (RFC 0004 §2).\n" +
      '    The demo never sends it: the person confirms in the app instead.',
  )
  if (await personConfirms(session, reviewPath(pro, project), delta.error?.message ?? ''))
    await readBack(session, project)
  await session.context.close()
}

// ---- 2. version 1 over HTTP: the projection route ----

const http = async () => {
  console.log('\n2. Version 1 over HTTP (the projection route, protocol 1)')
  const session = await sessionFor()
  const get = async (url: string) => (await (await session.fetcher(url)).json()) as View
  const project = projectOf(await get(`${base}/api/projection/view?policy=exhaustive`))
  const start = `hosting.project:${project}`
  const view = await get(
    `${base}/api/projection/view?${new URLSearchParams({ policy: 'exhaustive', start })}`,
  )
  evidence('GET /api/projection/view', `policy=exhaustive, start=${start}`)
  showComparison(view)
  const { member } = proOffer(view)
  const pro = member!.target!.key
  step(`POST /api/projection/execute ${member!.id}:`)
  const response = await session.fetcher(`${base}/api/projection/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      offer: member!.id,
      input: { plan: pro, projectId: project },
      policy: 'exhaustive',
      start,
    }),
  })
  const refusal = (await response.json()) as Refusal
  evidence(`HTTP ${response.status}`, {
    status: refusal.status,
    code: refusal.code,
    summary: refusal.confirmation?.summary,
  })
  check(
    refusal.code === 'confirmation_required',
    'refused for confirmation, with the summary to approve',
  )
  console.log(
    '    The wire gives the HTTP client, the host, an approval token for this exact call. A host never hands it to a\n' +
      "    model (RFC 0004 §4, §5), and the demo doesn't use it: the person confirms in the app.",
  )
  if (await personConfirms(session, reviewPath(pro, project), refusal.confirmation?.summary ?? ''))
    await readBack(session, project)
  await session.context.close()
}

// ---- 3. MCP: mcp-v1's generic tools, to a client that can't elicit ----

// a tool result's text
const text = (r: unknown) =>
  ((r as { content: { text: string }[] }).content ?? []).map((c) => c.text).join('')

const mcp = async () => {
  console.log('\n3. MCP (@affordances/mcp-v1, generic tools, over protocol 1 to the app)')
  const session = await sessionFor()
  const first = (await (
    await session.fetcher(`${base}/api/projection/view?policy=exhaustive`)
  ).json()) as View
  const project = projectOf(first)
  const server = createMcpServer({
    adapter: httpAdapter(`${base}/api/projection`, session.fetcher, {
      policy: 'exhaustive',
      start: { type: 'hosting.project', key: project },
    }),
    manifest,
  })
  const [toServer, toClient] = InMemoryTransport.createLinkedPair()
  await server.connect(toServer)
  // an MCP client that declares no elicitation, as most agents' don't: the server can't ask the person in-band
  const client = new Client({ name: 'demo-agent', version: '0.0.0' }, { capabilities: {} })
  await client.connect(toClient)
  const tools = (await client.listTools()).tools.map((t) => t.name)
  evidence('tools', tools)
  const viewed = text(await client.callTool({ name: 'project', arguments: {} }))
  noToken(viewed, 'project')
  const view = JSON.parse(viewed) as View
  showComparison(view)
  const { member } = proOffer(view)
  const pro = member!.target!.key
  step(`The agent calls execute on ${member!.id}:`)
  const refused = text(
    await client.callTool({
      name: 'execute',
      arguments: { offer: member!.id, input: { plan: pro, projectId: project } },
    }),
  )
  const refusal = JSON.parse(refused) as Refusal
  evidence('the tool returns', {
    status: refusal.status,
    code: refusal.code,
    summary: refusal.confirmation?.summary,
  })
  check(refusal.code === 'confirmation_required', 'refused for confirmation')
  noToken(refused, 'execute')
  await client.close()
  if (await personConfirms(session, reviewPath(pro, project), refusal.confirmation?.summary ?? ''))
    await readBack(session, project)
  await session.context.close()
}

// ---- 4. WebMCP: the page's own tools, in the person's browser ----

const webmcp = async () => {
  console.log("\n4. WebMCP (@affordances/webmcp, the page's generic tools, in flagged Chromium)")
  const session = await sessionFor()
  const page = session.page
  let tools: string[] = []
  for (let i = 0; i < 100 && tools.length === 0; i++) {
    tools = await page.evaluate(async () => {
      const context = (
        document as unknown as { modelContext?: { getTools(): Promise<{ name: string }[]> } }
      ).modelContext
      return context ? (await context.getTools()).map((t) => t.name) : []
    })
    if (tools.length === 0) await page.waitForTimeout(100)
  }
  evidence('the page registered', tools)
  if (tools.length === 0) {
    check(false, 'the page registered WebMCP tools (this Chromium needs --enable-features=WebMCP)')
    return
  }
  const call = (name: string, input: Record<string, unknown>) =>
    page.evaluate(
      async ([n, a]) => {
        const context = (
          document as unknown as {
            modelContext: {
              getTools(): Promise<{ name: string }[]>
              executeTool(t: unknown, a: unknown): Promise<unknown>
            }
          }
        ).modelContext
        const tool = (await context.getTools()).find((t) => t.name === n)
        const result = (await context.executeTool(tool, a)) as
          | { content?: { text: string }[] }
          | string
        // Chromium hands back the tool's result serialized, as a string; an object is read the same way
        const parsed = typeof result === 'string' ? (JSON.parse(result) as unknown) : result
        const content = (parsed as { content?: { text: string }[] } | null)?.content
        return Array.isArray(content) ? content.map((c) => c.text).join('') : String(result)
      },
      [name, input] as const,
    )
  const viewed = await call('project', {})
  noToken(viewed, 'project')
  const view = JSON.parse(viewed) as View
  showComparison(view)
  const project = projectOf(view)
  const { member } = proOffer(view)
  const pro = member!.target!.key
  step(`The agent calls execute on ${member!.id}:`)
  const refused = await call('execute', {
    offer: member!.id,
    input: { plan: pro, projectId: project },
  })
  const refusal = JSON.parse(refused) as Refusal
  evidence('the tool returns', {
    status: refusal.status,
    code: refusal.code,
    summary: refusal.confirmation?.summary,
  })
  check(
    refusal.code === 'confirmation_required',
    'refused for confirmation: no browser offers in-tool consent yet',
  )
  noToken(refused, 'execute')
  if (await personConfirms(session, reviewPath(pro, project), refusal.confirmation?.summary ?? ''))
    await readBack(session, project)
  await session.context.close()
}

try {
  await v0()
  await http()
  await mcp()
  await webmcp()
} finally {
  await browser.close()
  stopLab()
}
console.log(
  failures === 0
    ? '\nAll four transports: refused for confirmation, confirmed by the person, on Pro.'
    : `\n${failures} check(s) failed.`,
)
process.exit(failures === 0 ? 0 : 1)
