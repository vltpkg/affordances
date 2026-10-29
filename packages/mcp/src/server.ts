import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createClient, type ClientOptions } from './client.ts'

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const failure = (error: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: (error as Error).message }],
})

// two generic tools over any Afford site: read a page's graph, call one of its actions
// `instructions` (e.g. describeSite(index)) reach the model through the MCP client, so it knows the routes and
// actions before its first call
export const createServer = (
  site: string,
  options: ClientOptions & { instructions?: string } = {},
) => {
  const client = createClient(site, options)
  const server = new McpServer(
    { name: 'afford', version: '0.0.0' },
    options.instructions ? { instructions: options.instructions } : undefined,
  )
  const origin = new URL(site).origin

  server.registerTool(
    'afford_open',
    {
      title: 'Open a page',
      description: `Read a page on ${origin}: its entities (what the page shows), actions (what you can do there, with input schemas and availability), and nav (where to go next). Start at "/".`,
      inputSchema: { path: z.string().describe('A path on the site, e.g. /products/tee') },
      annotations: { readOnlyHint: true },
    },
    async ({ path }) => client.open(path).then(text, failure),
  )

  server.registerTool(
    'afford_call',
    {
      title: 'Call an action',
      description: `Call an action from a page's graph on ${origin}. Returns a delta: changed entities, output, actions that appeared or went away, and a redirect to open next. Actions with expose "confirm" first answer confirm_required with a summary: show it to the user, and only resend with confirm: true once they approve.`,
      inputSchema: {
        path: z.string().describe('The page the action is on'),
        action: z.string(),
        input: z.record(z.string(), z.unknown()).optional(),
        confirm: z.boolean().optional().describe('Only after the user approved the summary'),
      },
    },
    async ({ path, action, input, confirm }) =>
      client.call(path, action, input ?? {}, confirm).then(text, failure),
  )

  return server
}
