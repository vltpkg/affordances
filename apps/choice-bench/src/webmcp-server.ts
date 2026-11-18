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

export type WebMcpConfig = { url: string; session: string; out: string }
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
await page.goto(new URL('/', config.url).href)
await page.waitForFunction(
  () =>
    ((document as unknown as { modelContext?: { getTools(): unknown[] } }).modelContext?.getTools()
      .length ?? 0) > 0,
  undefined,
  { timeout: 30_000 },
)
save()

type PageTool = { name: string; description?: string; inputSchema?: unknown }
const toolsOf = (p: Page) =>
  p.evaluate(() =>
    (document as unknown as { modelContext: { getTools(): PageTool[] } }).modelContext
      .getTools()
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  )
const run = (p: Page, name: string, args: Record<string, unknown>) =>
  p.evaluate(
    async ([toolName, toolArgs]) => {
      const mc = (
        document as unknown as {
          modelContext: {
            getTools(): { name: string }[]
            executeTool(t: unknown, a: unknown): Promise<string>
          }
        }
      ).modelContext
      const tool = mc.getTools().find((t) => t.name === toolName)
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
  const tools = await toolsOf(page)
  record.toolLists.push(tools)
  save()
  return { tools: tools as { name: string; inputSchema: { type: 'object' } }[] }
})
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const at = Date.now()
  const call = record.calls.length
  const input = (params.arguments ?? {}) as Record<string, unknown>
  let text: string
  let isError = false
  try {
    text = await run(page, params.name, input)
  } catch (e) {
    isError = true
    text = 'The page’s tool failed.'
    record.errors.push({ call, tool: params.name, detail: (e as Error).message.split('\n')[0]! })
  }
  const output = parsed(text)
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
  return { content: [{ type: 'text' as const, text }], ...(isError && { isError: true }) }
})
const transport = new StdioServerTransport()
// oxlint-disable-next-line unicorn/prefer-add-event-listener
transport.onclose = () => void browser.close()
await server.connect(transport)
