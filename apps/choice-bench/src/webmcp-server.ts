import { reviewUrl } from '@affordances/hosting-lab/trial'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium, type Page } from 'playwright'
import type { McpCall } from './mcp-server.ts'

// the WebMCP pilot surface's bridge, as a driver launches it: node src/webmcp-server.ts <config.json> (surfaces/
// PLAN.md §3; design, 14:10Z and 15:02Z). Chromium with WebMCP on, the trial's own app open in it, and the tools the
// page registers through @affordances/webmcp relayed to the agent unchanged: tools/list is the page's getTools(), and
// tools/call its executeTool. The session is the app's HttpOnly sid cookie and the context is confined to the trial's
// origin, as on the browser surface. Confirmation fails closed, since no browser offers requestUserInteraction: the
// refused execute is the request event, and the simulated person completes it in the app, on its review-and-confirm
// page, in a tab of the same session, so the agent's page is left as it was

// toolsTimeoutMs: how long the page may take to register its tools after a navigation (30s by default)
export type WebMcpConfig = { url: string; session: string; out: string; toolsTimeoutMs?: number }
export type WebMcpRecord = {
  surface: 'webmcp'
  url: string
  chromium: string
  playwright: string
  launchArgs: string[]
  // the tools as the page registered them, each time the agent listed them
  toolLists: unknown[]
  calls: McpCall[]
  // the simulated person's completions on the review page, each after a refusal for confirmation
  completions: { call: number; review: string; confirmed: boolean; at: number; detail?: string }[]
  aborted: { url: string; at: number }[]
  errors: { call: number; tool: string; detail: string }[]
}

const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as WebMcpConfig
const origin = new URL(config.url).origin
// WebMCP's own flag (rfcs/research/0004-webmcp/SPIKE.md): the only one, and recorded
const LAUNCH_ARGS = ['--enable-features=WebMCP']
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS })
const record: WebMcpRecord = {
  surface: 'webmcp',
  url: config.url,
  chromium: browser.version(),
  playwright: (createRequire(import.meta.url)('playwright/package.json') as { version: string })
    .version,
  launchArgs: LAUNCH_ARGS,
  toolLists: [],
  calls: [],
  completions: [],
  aborted: [],
  errors: [],
}
const save = () => {
  writeFileSync(`${config.out}.tmp`, JSON.stringify(record))
  renameSync(`${config.out}.tmp`, config.out)
}
const context = await browser.newContext()
await context.addCookies([
  { name: 'sid', value: config.session, url: config.url, httpOnly: true, sameSite: 'Lax' },
])
await context.route('**/*', async (route) => {
  const url = route.request().url()
  if (new URL(url).origin === origin) return route.continue()
  record.aborted.push({ url, at: Date.now() })
  save()
  return route.abort('blockedbyclient')
})
// the agent's page: the app's home, whose tools it registers on load
const page = await context.newPage()
// getTools() is asynchronous (design's measure.mjs awaits it): the page is ready once it lists a tool. The wait is
// bounded, and it runs again after every navigation of the agent's page, so no call reaches a document whose tools
// aren't registered yet (the planner, 17:26Z). A timeout is the harness's fault, recorded as a stall, and the bridge
// keeps serving, so the record is written and the runner sets the trial aside
const TOOLS_TIMEOUT_MS = config.toolsTimeoutMs ?? 30_000
// polled here, awaiting getTools() each time. Playwright 1.64's waitForFunction does await an async predicate, but
// then resolves with its value even when it's falsy, instead of polling until it's truthy: measured, it resolved in
// 3 to 28ms with the value false. So the old wait returned at once, tools or not (the stub-site test caught it)
const toolCount = () =>
  page
    .evaluate(
      async () =>
        (
          await (
            document as unknown as { modelContext?: { getTools(): Promise<unknown[]> } }
          ).modelContext?.getTools()
        )?.length ?? 0,
    )
    // a document being replaced mid-evaluate has no tools yet
    .catch(() => 0)
const waitForTools = async () => {
  const deadline = Date.now() + TOOLS_TIMEOUT_MS
  while (Date.now() < deadline) {
    if ((await toolCount()) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  record.errors.push({
    call: record.calls.length,
    tool: 'wait',
    detail: `the page registered no tools within ${TOOLS_TIMEOUT_MS}ms`,
  })
  save()
}
let ready = Promise.resolve()
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) ready = waitForTools()
})
await page.goto(new URL('/', config.url).href)
await ready
save()

type PageTool = { name: string; description?: string; inputSchema?: unknown }
const toolsOf = (p: Page) =>
  p.evaluate(async () =>
    (
      await (
        document as unknown as { modelContext: { getTools(): Promise<PageTool[]> } }
      ).modelContext.getTools()
    ).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  )
const run = (p: Page, name: string, args: Record<string, unknown>) =>
  p.evaluate(
    async ([toolName, toolArgs]) => {
      const mc = (
        document as unknown as {
          modelContext: {
            getTools(): Promise<{ name: string }[]>
            executeTool(t: unknown, a: unknown): Promise<string>
          }
        }
      ).modelContext
      const tool = (await mc.getTools()).find((t) => t.name === toolName)
      if (!tool) throw new Error(`the page has no tool ${toolName}`)
      return mc.executeTool(tool, toolArgs)
    },
    [name, args] as const,
  )
const parsed = (text: string) => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

// the simulated person approves, as on every surface: in the app, on the review page of the refused call, and in the
// same session, then back to the agent
const complete = async (call: number, offer: string, input: unknown) => {
  // the review page's fields: what the offer id fixes, from the manifest, then the call's own input (reviewUrl)
  const review = reviewUrl(offer, input)
  if (!review) return
  const tab = await context.newPage()
  try {
    await tab.goto(new URL(review, config.url).href)
    const confirm = tab.locator('[data-confirm]')
    if (!(await confirm.count())) {
      record.completions.push({
        call,
        review,
        confirmed: false,
        at: Date.now(),
        detail: 'the review page offered no confirm',
      })
      return
    }
    await Promise.all([
      tab.waitForURL((u) => u.pathname !== '/review', { timeout: 10_000 }),
      confirm.click(),
    ])
    record.completions.push({ call, review, confirmed: true, at: Date.now() })
  } catch (e) {
    record.completions.push({
      call,
      review,
      confirmed: false,
      at: Date.now(),
      detail: (e as Error).message.split('\n')[0],
    })
  } finally {
    await tab.close()
  }
}

const server = new Server(
  { name: 'webmcp-bridge', version: '0.0.0' },
  { capabilities: { tools: {} } },
)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  await ready
  const tools = await toolsOf(page)
  record.toolLists.push(tools)
  // design (17:26Z): the page's tools go from none to four at hydration and never drop, so an empty list after the
  // wait is unexplained. It's the harness's fault, a stall, never the agent's, and its trace goes to design
  if (!tools.length)
    record.errors.push({
      call: record.calls.length,
      tool: 'tools/list',
      detail: 'the page listed no tools after its wait',
    })
  save()
  return { tools: tools as { name: string; inputSchema: { type: 'object' } }[] }
})
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const at = Date.now()
  const call = record.calls.length
  const input = (params.arguments ?? {}) as Record<string, unknown>
  let text: string
  let isError = false
  await ready
  try {
    text = await run(page, params.name, input)
  } catch (e) {
    isError = true
    text = 'The page’s tool failed.'
    record.errors.push({ call, tool: params.name, detail: (e as Error).message.split('\n')[0]! })
  }
  // executeTool answers with the page tool's own result, { content, isError }, as JSON: relayed as it is, and its text
  // recorded, as the other MCP servers record theirs
  const result = parsed(text) as { content?: { type: 'text'; text: string }[]; isError?: boolean }
  const content = Array.isArray(result?.content)
    ? result.content
    : [{ type: 'text' as const, text }]
  isError ||= result?.isError === true
  const output = parsed(content.map((c) => c.text).join(''))
  record.calls.push({ tool: params.name, input, output, isError, at, ms: Date.now() - at })
  save()
  const refusal = output as { status?: string; code?: string }
  if (
    params.name === 'execute' &&
    refusal?.status === 'refused' &&
    refusal.code === 'confirmation_required'
  ) {
    await complete(call, String(input.offer), input.input)
    save()
  }
  return { content, ...(isError && { isError: true }) }
})
const transport = new StdioServerTransport()
// oxlint-disable-next-line unicorn/prefer-add-event-listener
transport.onclose = () => void browser.close()
await server.connect(transport)
