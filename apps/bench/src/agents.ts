import { chromium, type Browser } from 'playwright'
import { createClient, describeSite } from '@affordances/mcp'
import type { Tool } from './loop.ts'

// each agent starts on a session the task set up, so the check can read that session's cart and orders

const json = (value: unknown) => JSON.stringify(value)

export const affordAgent = async (site: string, sid: string) => {
  // the same session a browser would carry as its sid cookie
  const client = createClient(site, { token: sid })
  // what an MCP client would get as the server's instructions: every route and action, before the first call
  const index = describeSite(await client.index())
  const tools: Tool[] = [
    {
      name: 'affordances_open',
      description:
        'Read a page: its entities (what the page shows), actions (what you can do there, with input schemas and availability), and nav. Start at "/".',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      run: async ({ path }) => json(await client.open(path as string)),
    },
    {
      name: 'affordances_call',
      description:
        'Call an action from a page graph. Returns a delta: changed entities, output, actions that appeared or went away, and a redirect to open next. Actions with expose "confirm" answer confirm_required first; resend with confirm: true once the user has approved.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          action: { type: 'string' },
          input: { type: 'object' },
          confirm: { type: 'boolean' },
        },
        required: ['path', 'action'],
      },
      run: async ({ path, action, input, confirm }) =>
        json(
          await client.call(
            path as string,
            action as string,
            input ?? {},
            confirm as boolean | undefined,
          ),
        ),
    },
  ]
  return {
    name: 'afford' as const,
    system: `You operate the website at ${site} through its Affordances graph. Use affordances_open and affordances_call. When the task is done, reply with a one-line summary.\n\n${index}`,
    tools,
    close: async () => {},
  }
}

// the launch promise, not the browser: two agents starting at once must share one chromium, not race to launch two
let browser: Promise<Browser> | undefined

// the baseline: a DOM agent reading the accessibility tree (cheaper than screenshots, so a conservative comparison)
export const browserAgent = async (site: string, sid: string) => {
  browser ??= chromium.launch()
  const context = await (await browser).newContext({ baseURL: site })
  await context.addCookies([{ name: 'sid', value: sid, url: site }])
  // the store's Agent view toggle is a demo control no real store has; it would hand this agent the graph
  await context.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = '[data-demo-only] { display: none !important }'
      document.head.append(style)
    })
  })
  const page = await context.newPage()
  const snapshot = async () => {
    await page.waitForLoadState('networkidle').catch(() => {})
    return `${page.url()}\n${await page.locator('body').ariaSnapshot()}`
  }
  const tools: Tool[] = [
    {
      name: 'goto',
      description: 'Open a path on the site and return the page as an accessibility snapshot.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      run: async ({ path }) => {
        await page.goto(path as string)
        return snapshot()
      },
    },
    {
      name: 'click',
      description:
        'Click the element with this ARIA role and accessible name, then return the new snapshot.',
      input_schema: {
        type: 'object',
        properties: { role: { type: 'string' }, name: { type: 'string' } },
        required: ['role', 'name'],
      },
      run: async ({ role, name }) => {
        const target = page.getByRole(role as never, { name: name as string, exact: true }).first()
        // styled radios and checkboxes are usually a visually hidden input under its label, which takes the
        // pointer; check() with force selects it the way a person clicking the label would
        if (role === 'radio' || role === 'checkbox')
          await target.check({ force: true, timeout: 5000 })
        else await target.click({ timeout: 5000 })
        return snapshot()
      },
    },
    {
      name: 'fill',
      description: 'Type into the field with this label, then return the new snapshot.',
      input_schema: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label', 'value'],
      },
      run: async ({ label, value }) => {
        await page
          .getByLabel(label as string)
          .first()
          .fill(value as string, { timeout: 5000 })
        return snapshot()
      },
    },
    {
      name: 'press',
      description: 'Press a key (e.g. Enter) in the focused element, then return the new snapshot.',
      input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      run: async ({ key }) => {
        await page.keyboard.press(key as string)
        return snapshot()
      },
    },
  ]
  return {
    name: 'browser' as const,
    // the recorder screenshots it for the demo; the model only ever gets the snapshot text
    page,
    system: `You operate the website at ${site} in a browser. Start with goto("/"). Each tool returns the page as an accessibility snapshot. When the task is done, reply with a one-line summary.`,
    tools,
    close: () => context.close(),
  }
}

export const closeBrowser = async () => (await browser)?.close()

type PageTool = { name: string; description: string; inputSchema: Tool['input_schema'] }

// the same browser agent in a browser that supports WebMCP: tools the current page registers join its toolbox
// on the next turn, the way a WebMCP-capable browser offers them. nothing tells it about Affordances; the store's
// <AffordancesProvider> registers each available action, and the agent decides whether to use them
export const webmcpAgent = async (site: string, sid: string) => {
  const agent = await browserAgent(site, sid)
  const { page } = agent
  // ponytail: a shim of WebMCP's registerTool (no shipping chromium has it yet); swap for the real API when
  // playwright's chromium does
  await page.context().addInitScript(() => {
    const tools = new Map<string, { execute: (input: unknown) => Promise<unknown> }>()
    Object.assign(window, { webmcpTools: tools })
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool: (
          tool: { name: string; execute: (input: unknown) => Promise<unknown> },
          options?: { signal?: AbortSignal },
        ) => {
          tools.set(tool.name, tool)
          options?.signal?.addEventListener('abort', () => {
            if (tools.get(tool.name) === tool) tools.delete(tool.name)
          })
        },
      },
    })
  })
  // the page navigated or re-registered: read what it offers now
  const pageTools = () =>
    page
      .evaluate(() =>
        [
          ...((
            window as unknown as {
              webmcpTools?: Map<string, { name: string; description: string; inputSchema: unknown }>
            }
          ).webmcpTools?.values() ?? []),
        ].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      )
      .catch(() => [] as never[]) as Promise<PageTool[]>
  const builtIn = new Set(agent.tools.map((t) => t.name))
  return {
    ...agent,
    name: 'webmcp' as const,
    system: `${agent.system} Pages can register their own tools (WebMCP): while you're on such a page, they appear in your tool list.`,
    tools: async (): Promise<Tool[]> => [
      ...agent.tools,
      ...(await pageTools())
        .filter((tool) => !builtIn.has(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: `${tool.description} (registered by the page)`,
          input_schema: tool.inputSchema,
          run: async (input: Record<string, unknown>) => {
            const result = await page.evaluate(
              ([name, args]) =>
                (
                  window as unknown as {
                    webmcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }>
                  }
                ).webmcpTools
                  .get(name)!
                  .execute(args),
              [tool.name, input] as const,
            )
            return typeof result === 'string' ? result : JSON.stringify(result)
          },
        })),
    ],
  }
}
