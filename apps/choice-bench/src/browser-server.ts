import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { z } from 'zod'

// the browser surface's tool server, as a driver launches it: node src/browser-server.ts <config.json> (surfaces/
// PLAN.md §3; the planner, 15:11Z). Pure browser automation: Chromium, with no flag beyond Playwright's own (no
// WebMCP), on the trial's own server. Exactly five tools, open, snapshot, click, fill and submit, each answering with
// the page's ARIA snapshot in Playwright's 'ai' mode, whose [ref=eN] refs the next call names. The trial's session is
// the app's HttpOnly sid cookie, set on the browser context before the first load, so the agent never holds it. The
// context is confined to the trial's origin: any other request is aborted, and recorded

export type BrowserConfig = { url: string; session: string; out: string }
export type BrowserCall = {
  tool: string
  input: Record<string, unknown>
  output: string
  isError: boolean
  at: number
  ms: number
  // how long the page took to settle after the tool acted, before its snapshot (the settle-wait, intake 19:35Z), and
  // whether the 10 s bound was hit first
  settleMs?: number
  settleTimedOut?: boolean
}
// a main-frame load: its url, and on the review page, the selection it carries (its action and fields)
export type BrowserLoad = { url: string; at: number; review?: Record<string, string> }
export type BrowserRecord = {
  surface: 'browser'
  url: string
  chromium: string
  playwright: string
  // the flags Chromium was launched with beyond Playwright's defaults: none, so no WebMCP
  launchArgs: string[]
  // the session cookie as the browser holds it, its value never recorded: HttpOnly, so no page script can read it
  sessionCookie?: { name: string; httpOnly: boolean; sameSite: string }
  toolLists: unknown[]
  calls: BrowserCall[]
  loads: BrowserLoad[]
  // each click or submit that confirmed a review: the call's index, and whether it hit [data-confirm]
  confirms: { call: number; at: number }[]
  // requests to any other origin, aborted
  aborted: { url: string; at: number }[]
  // a ref that was in the immediately preceding snapshot and didn't resolve: the PLAN's harness stall (§5)
  stalls: { call: number; tool: string; ref: string; detail: string }[]
  // the browser itself failed, not the agent: the PLAN's other browser stall ('the browser driver threw')
  errors: { call: number; tool: string; detail: string }[]
}

const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as BrowserConfig
const origin = new URL(config.url).origin
const LAUNCH_ARGS: string[] = []
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS })
const playwright = (
  createRequire(import.meta.url)('playwright/package.json') as { version: string }
).version
const record: BrowserRecord = {
  surface: 'browser',
  url: config.url,
  chromium: browser.version(),
  playwright,
  launchArgs: LAUNCH_ARGS,
  toolLists: [],
  calls: [],
  loads: [],
  confirms: [],
  aborted: [],
  stalls: [],
  errors: [],
}
// the off-site page a call's navigation was stopped at, if any
let left: string | undefined
const save = () => {
  writeFileSync(`${config.out}.tmp`, JSON.stringify(record))
  renameSync(`${config.out}.tmp`, config.out)
}
const context = await browser.newContext()
await context.addCookies([
  { name: 'sid', value: config.session, url: config.url, httpOnly: true, sameSite: 'Lax' },
])
// confined at the context, so no link, redirect or script leaves the trial's origin
await context.route('**/*', async (route) => {
  const url = route.request().url()
  if (new URL(url).origin === origin) return route.continue()
  record.aborted.push({ url, at: Date.now() })
  // a link or redirect off the site: the page it would have replaced comes back, and the agent is told (below)
  if (route.request().isNavigationRequest() && !route.request().frame().parentFrame()) left = url
  save()
  return route.abort('blockedbyclient')
})
const held = (await context.cookies()).find((c) => c.name === 'sid')
if (held)
  record.sessionCookie = { name: held.name, httpOnly: held.httpOnly, sameSite: held.sameSite }
const page = await context.newPage()
page.on('framenavigated', (frame) => {
  if (frame !== page.mainFrame()) return
  const u = new URL(frame.url())
  // Chromium's error page for a stopped navigation is no load of the site
  if (u.origin !== origin) return
  const load: BrowserLoad = { url: frame.url(), at: Date.now() }
  if (u.origin === origin && u.pathname === '/review')
    load.review = Object.fromEntries(u.searchParams.entries())
  record.loads.push(load)
  save()
})
save()

// the settle-wait (the re-pilot's one fault, and intake's ruling, 19:35Z): a tool that can navigate (open, click, fill,
// submit) snapshots only once the page has settled. The app's Confirm runs a server action, then redirects on the
// client, with no new document, so waiting for 'load' alone snapshotted the page before the redirect, and the agent was
// shown a stale review page. The page's own requests are the signal: its navigation and whatever it triggers are each
// in flight until they finish. So it's settled once none has been in flight for 300 ms, bounded at 10 s
const SETTLE_QUIET_MS = 300
const SETTLE_BOUND_MS = 10_000
let inflight = 0
context.on('request', () => inflight++)
context.on('requestfinished', () => inflight--)
context.on('requestfailed', () => inflight--)
// the last call's settle, on an object so its reset before each call and its write inside settle() both hold
const settling: { last?: { ms: number; timedOut: boolean } } = {}
// the trace's fields for the last call's settle, read through a function, so no narrowing of the reset holds
const settleFields = (): { settleMs?: number; settleTimedOut?: boolean } =>
  settling.last ? { settleMs: settling.last.ms, settleTimedOut: settling.last.timedOut } : {}
const settle = async () => {
  const t0 = Date.now()
  let quietSince: number | undefined
  for (;;) {
    const now = Date.now()
    if (inflight <= 0) {
      quietSince ??= now
      if (now - quietSince >= SETTLE_QUIET_MS) break
    } else quietSince = undefined
    if (now - t0 >= SETTLE_BOUND_MS) {
      settling.last = { ms: now - t0, timedOut: true }
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  await page.waitForLoadState('load').catch(() => {})
  settling.last = { ms: Date.now() - t0, timedOut: false }
}

// the refs the agent was last shown: a call naming one of these that won't resolve is the harness's fault
let shown = new Set<string>()
const snapshot = async () => {
  await page.waitForLoadState('load').catch(() => {})
  const tree = await page.ariaSnapshot({ mode: 'ai' })
  shown = new Set([...tree.matchAll(/\[ref=(\w+)\]/g)].map((m) => m[1]!))
  const u = new URL(page.url())
  return `Page: ${u.origin === origin ? `${u.pathname}${u.search}` : page.url()}\n${tree}`
}

// an agent's mistake, which it's told about, never the harness's
class AgentError extends Error {}
const element = async (call: number, tool: string, ref: string) => {
  if (!shown.has(ref)) throw new AgentError(`No element has ref ${ref} in the last snapshot`)
  const locator = page.getByRef(ref)
  try {
    await locator.waitFor({ state: 'attached', timeout: 5000 })
    return locator
  } catch (e) {
    record.stalls.push({
      call,
      tool,
      ref,
      detail: e instanceof Error ? e.message.split('\n')[0]! : String(e),
    })
    throw new AgentError(`The element ${ref} couldn’t be found on the page`)
  }
}
// whether a click or submit confirms a review: its element, or the form it submits, carries [data-confirm]
const confirms = (locator: ReturnType<typeof page.getByRef>) =>
  locator.evaluate(
    (el) =>
      el.closest('[data-confirm]') !== null ||
      (el instanceof HTMLFormElement && el.querySelector('[data-confirm]') !== null),
  )

const TOOLS = {
  open: {
    description: `Open a page of ${origin}, by its path, and show it.`,
    inputSchema: { path: z.string().describe('A path on the site, e.g. /plans') },
    run: async (_call: number, { path }: { path: string }) => {
      const to = new URL(path, config.url)
      if (to.origin !== origin) throw new AgentError(`${to.href} isn’t on ${origin}`)
      await page.goto(to.href)
      await settle()
      return snapshot()
    },
  },
  snapshot: {
    description: 'Show the current page, with a ref for each element you can act on.',
    inputSchema: {},
    run: async () => snapshot(),
  },
  click: {
    description: 'Click the element with this ref, then show the page.',
    inputSchema: { ref: z.string().describe('A ref from the last snapshot, e.g. e12') },
    run: async (call: number, { ref }: { ref: string }) => {
      const locator = await element(call, 'click', ref)
      if (await confirms(locator)) record.confirms.push({ call, at: Date.now() })
      await locator.click()
      await settle()
      return snapshot()
    },
  },
  fill: {
    description: 'Type this value into the field with this ref, then show the page.',
    inputSchema: { ref: z.string(), value: z.string() },
    run: async (call: number, { ref, value }: { ref: string; value: string }) => {
      await (await element(call, 'fill', ref)).fill(value)
      await settle()
      return snapshot()
    },
  },
  submit: {
    description: 'Submit the form that holds the element with this ref, then show the page.',
    inputSchema: { ref: z.string() },
    run: async (call: number, { ref }: { ref: string }) => {
      const locator = await element(call, 'submit', ref)
      const ok = await locator.evaluate((el) => {
        const form = el instanceof HTMLFormElement ? el : el.closest('form')
        return form ? (form.querySelector('[data-confirm]') !== null ? 'confirm' : 'form') : 'none'
      })
      if (ok === 'none') throw new AgentError(`The element ${ref} isn’t in a form`)
      if (ok === 'confirm') record.confirms.push({ call, at: Date.now() })
      await Promise.all([
        page.waitForEvent('framenavigated', { timeout: 10_000 }).catch(() => {}),
        locator.evaluate((el) => {
          const form = (el instanceof HTMLFormElement ? el : el.closest('form'))!
          form.requestSubmit()
        }),
      ])
      await settle()
      return snapshot()
    },
  },
} as const

const server = new McpServer({ name: 'browser', version: '0.0.0' })
for (const [name, tool] of Object.entries(TOOLS))
  // one loop over the fixed set: the five schemas differ, so the SDK's per-tool typing is widened here
  server.registerTool(
    name,
    { description: tool.description, inputSchema: tool.inputSchema as {} },
    async (input: Record<string, unknown>) => {
      const at = Date.now()
      const call = record.calls.length
      let output: string
      let isError = false
      left = undefined
      settling.last = undefined
      try {
        output = await (
          tool.run as (call: number, input: Record<string, unknown>) => Promise<string>
        )(call, input)
        if (left) {
          if (new URL(page.url()).origin !== origin) await page.goBack()
          output = `That goes to ${left}, off the site, so it wasn’t followed.\n${await snapshot()}`
        }
      } catch (e) {
        isError = true
        if (e instanceof AgentError) output = e.message
        else {
          output = 'The browser failed.'
          record.errors.push({
            call,
            tool: name,
            detail: e instanceof Error ? e.message : String(e),
          })
        }
      }
      record.calls.push({
        tool: name,
        input,
        output,
        isError,
        at,
        ms: Date.now() - at,
        ...settleFields(),
      })
      save()
      return {
        content: [{ type: 'text' as const, text: output }],
        ...(isError && { isError: true }),
      }
    },
  )
const transport = new StdioServerTransport()
// oxlint-disable-next-line unicorn/prefer-add-event-listener
transport.onclose = () => void browser.close()
await server.connect(transport)
