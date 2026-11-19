import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { appendFileSync } from 'node:fs'
import { z } from 'zod'

// M5a's smoke test: one tool and a task that can't be got wrong, to see a driver call a tool and finish. It logs
// each call at the server, which is the record a driver's trace is compared with (RFC 0003 §5.1)
const log = process.argv[2]
const server = new McpServer({ name: 'bench', version: '0.0.0' })
server.registerTool(
  'lookup',
  { description: 'Look up the word for a key', inputSchema: { key: z.string() } },
  async ({ key }) => {
    if (log) appendFileSync(log, `${JSON.stringify({ tool: 'lookup', input: { key } })}\n`)
    return { content: [{ type: 'text', text: key === 'color' ? 'teal' : 'unknown' }] }
  },
)
await server.connect(new StdioServerTransport())
