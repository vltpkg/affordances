import { chromium, type Browser } from 'playwright'
import { createClient } from '@afford/mcp'
import type { Tool } from './loop.ts'

// each agent starts on a session the task set up, so the check can read that session's cart and orders

export const affordAgent = (site: string, sid: string) => {
  // the same session a browser would carry as its sid cookie
  const client = createClient(site, { token: sid })
  const json = (value: unknown) => JSON.stringify(value)
  const tools: Tool[] = [
    {
      name: 'afford_open',
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
      name: 'afford_call',
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
    system: `You operate the website at ${site} through its Afford graph. Use afford_open and afford_call. When the task is done, reply with a one-line summary.`,
    tools,
    close: async () => {},
  }
}

let browser: Browser | undefined

// the baseline: a DOM agent reading the accessibility tree (cheaper than screenshots, so a conservative comparison)
export const browserAgent = async (site: string, sid: string) => {
  browser ??= await chromium.launch()
  const context = await browser.newContext({ baseURL: site })
  await context.addCookies([{ name: 'sid', value: sid, url: site }])
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
        await page
          .getByRole(role as never, { name: name as string, exact: true })
          .first()
          .click({ timeout: 5000 })
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
    system: `You operate the website at ${site} in a browser. Start with goto("/"). Each tool returns the page as an accessibility snapshot. When the task is done, reply with a one-line summary.`,
    tools,
    close: () => context.close(),
  }
}

export const closeBrowser = () => browser?.close()
