import { chromium, type Browser } from 'playwright'
import { createClient, describeSite, signature } from '@affordances/mcp'
import type Anthropic from '@anthropic-ai/sdk'
import type { Tool, ToolOutput } from './loop.ts'

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

// a page on the task's session, for the agents that drive a browser
const openPage = async (
  site: string,
  sid: string,
  viewport?: { width: number; height: number },
) => {
  browser ??= chromium.launch()
  const context = await (await browser).newContext({ baseURL: site, viewport })
  await context.addCookies([{ name: 'sid', value: sid, url: site }])
  // the store's Agent view toggle is a demo control no real store has; it would hand the agent the graph
  await context.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = '[data-demo-only] { display: none !important }'
      document.head.append(style)
    })
  })
  return { context, page: await context.newPage() }
}

// the baseline: a DOM agent reading the accessibility tree (cheaper than screenshots, so a conservative comparison)
export const browserAgent = async (site: string, sid: string) => {
  const { context, page } = await openPage(site, sid)
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
export const webmcpAgent = async (
  site: string,
  sid: string,
  // how page tools reach the model. 'toolbox': each joins the tool list, so the list changes page to page and
  // the prompt cache with it. 'stable': one fixed page_tool, with each page's tools listed in the tool results
  { delivery = 'stable' }: { delivery?: 'toolbox' | 'stable' } = {},
) => {
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
  const builtIn = new Set(agent.tools.map((t) => t.name))
  // the page navigated or re-registered: read what it offers now
  const pageTools = async () =>
    (
      (await page
        .evaluate(() =>
          [
            ...((
              window as unknown as {
                webmcpTools?: Map<
                  string,
                  { name: string; description: string; inputSchema: unknown }
                >
              }
            ).webmcpTools?.values() ?? []),
          ].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        )
        .catch(() => [])) as PageTool[]
    ).filter((tool) => !builtIn.has(tool.name))
  const callPageTool = async (name: string, input: unknown) => {
    const result = await page.evaluate(
      ([tool, args]) => {
        const registered = (
          window as unknown as {
            webmcpTools: Map<string, { execute: (input: unknown) => Promise<unknown> }>
          }
        ).webmcpTools.get(tool)
        if (!registered) throw new Error(`This page has no tool named ${tool}`)
        return registered.execute(args)
      },
      [name, input] as const,
    )
    return typeof result === 'string' ? result : JSON.stringify(result)
  }

  if (delivery === 'toolbox')
    return {
      ...agent,
      name: 'webmcp' as const,
      offered: async () => (await pageTools()).map((tool) => tool.name),
      system: `${agent.system} Pages can register their own tools (WebMCP): while you're on such a page, they appear in your tool list.`,
      tools: async (): Promise<Tool[]> => [
        ...agent.tools,
        ...(await pageTools()).map((tool) => ({
          name: tool.name,
          description: `${tool.description} (registered by the page)`,
          input_schema: tool.inputSchema,
          run: (input: Record<string, unknown>) => callPageTool(tool.name, input),
        })),
      ],
    }

  // what the page offers, under each result, so the model sees it the moment it lands on the page
  const listing = async () => {
    const tools = await pageTools()
    return tools.length
      ? `\n\nTools this page registered (WebMCP), callable with page_tool:\n${tools
          .map(
            (t) =>
              `- ${signature(t.name, t.inputSchema as Parameters<typeof signature>[1])}: ${t.description}`,
          )
          .join('\n')}`
      : ''
  }
  const tools: Tool[] = [
    ...agent.tools.map((tool) => ({
      ...tool,
      run: async (input: Record<string, unknown>) => `${await tool.run(input)}${await listing()}`,
    })),
    {
      name: 'page_tool',
      description:
        'Call a tool the current page registered over WebMCP, by name, with its input. The tools a page offers are listed under each result while you are on it.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string' }, input: { type: 'object' } },
        required: ['name'],
      },
      run: async ({ name, input }) =>
        `${await callPageTool(name as string, input ?? {})}${await listing()}`,
    },
  ]
  return {
    ...agent,
    name: 'webmcp' as const,
    offered: async () => (await pageTools()).map((tool) => tool.name),
    system: `${agent.system} Pages can register their own tools (WebMCP): when a page does, they're listed under your tool results, and page_tool calls them.`,
    tools,
  }
}

// xdotool-style key names, which computer use sends, to playwright's
const KEYS: Record<string, string> = {
  return: 'Enter',
  enter: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  space: 'Space',
  page_down: 'PageDown',
  page_up: 'PageUp',
  home: 'Home',
  end: 'End',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  shift: 'Shift',
  super: 'Meta',
  cmd: 'Meta',
  meta: 'Meta',
}
const key = (combo: string) =>
  combo
    .split('+')
    .map((k) => KEYS[k.toLowerCase()] ?? (k.length === 1 ? k : k[0]!.toUpperCase() + k.slice(1)))
    .join('+')

const SCREEN = { width: 1280, height: 800 }

// the way most browser agents work today: Claude's computer use toolset on a 1280x800 screen. it sees only
// screenshots and acts by coordinates and keystrokes; goto opens a path, as the snapshot agent's does
export const visionAgent = async (site: string, sid: string) => {
  const { context, page } = await openPage(site, sid, SCREEN)
  let cursor: [number, number] = [0, 0]
  const screenshot = async (): Promise<ToolOutput> => {
    await page.waitForLoadState('networkidle').catch(() => {})
    const data = (await page.screenshot({ type: 'png' })).toString('base64')
    return [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }]
  }
  const at = (input: Record<string, unknown>) => {
    if (Array.isArray(input.coordinate)) cursor = input.coordinate as [number, number]
    return cursor
  }
  // modifier keys held around a click or scroll, e.g. shift
  const held = async (text: unknown, act: () => Promise<void>) => {
    const keys = typeof text === 'string' && text ? key(text).split('+') : []
    for (const k of keys) await page.keyboard.down(k)
    await act()
    for (const k of keys.toReversed()) await page.keyboard.up(k)
  }
  const click =
    (count: number, button: 'left' | 'right' = 'left') =>
    async (input: Record<string, unknown>) => {
      const [x, y] = at(input)
      await held(input.text, () => page.mouse.click(x, y, { clickCount: count, button }))
      return 'OK'
    }
  const members: Record<string, (input: Record<string, unknown>) => Promise<ToolOutput>> = {
    screenshot,
    left_click: click(1),
    double_click: click(2),
    triple_click: click(3),
    right_click: click(1, 'right'),
    mouse_move: async (input) => {
      const [x, y] = at(input)
      await page.mouse.move(x, y)
      return 'OK'
    },
    left_click_drag: async (input) => {
      const [sx, sy] = input.start_coordinate as [number, number]
      const [x, y] = at(input)
      await page.mouse.move(sx, sy)
      await page.mouse.down()
      await page.mouse.move(x, y)
      await page.mouse.up()
      return 'OK'
    },
    scroll: async (input) => {
      const [x, y] = at(input)
      const n = Number(input.scroll_amount ?? 3) * 100
      const d = String(input.scroll_direction)
      await page.mouse.move(x, y)
      await held(input.text, () =>
        page.mouse.wheel(
          d === 'left' ? -n : d === 'right' ? n : 0,
          d === 'up' ? -n : d === 'down' ? n : 0,
        ),
      )
      return 'OK'
    },
    type: async (input) => (await page.keyboard.type(String(input.text)), 'OK'),
    key: async (input) => {
      for (let i = 0; i < Number(input.repeat ?? 1); i++)
        await page.keyboard.press(key(String(input.text)))
      return 'OK'
    },
    wait: async (input) => {
      await page.waitForTimeout(Math.min(Number(input.duration ?? 1), 10) * 1000)
      return 'OK'
    },
    cursor_position: async () => `X=${cursor[0]}, Y=${cursor[1]}`,
  }
  const tools: Tool[] = [
    {
      name: 'goto',
      description: 'Open a path on the site and return a screenshot of it.',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      run: async ({ path }) => {
        await page.goto(path as string)
        return screenshot()
      },
    },
    {
      name: 'computer',
      input_schema: { type: 'object' },
      // members this harness doesn't implement are switched off, as the docs advise, rather than erroring
      definition: {
        type: 'computer_toolset_20260801',
        configs: Object.fromEntries(
          ['zoom', 'middle_click', 'left_mouse_down', 'left_mouse_up', 'hold_key'].map((m) => [
            m,
            { enabled: false },
          ]),
        ),
      } as unknown as Anthropic.ToolUnion,
      run: async (input, member) => {
        const run = members[member ?? '']
        if (!run) throw new Error(`Unsupported computer action: ${member}`)
        return run(input)
      },
    },
  ]
  return {
    name: 'vision' as const,
    page,
    system: `You operate the website at ${site} in a browser, through the computer tools on a ${SCREEN.width}x${SCREEN.height} screen. Start with goto("/"), which returns a screenshot. Actions answer OK; take a screenshot (in the same turn, after your actions) to see the result. When the task is done, reply with a one-line summary.`,
    tools,
    close: () => context.close(),
  }
}
