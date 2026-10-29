#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createClient } from './client.ts'
import { describeSite } from './describe.ts'
import { createServer } from './server.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { token: { type: 'string' } },
})
const [site] = positionals
if (!site) {
  console.error('usage: afford-mcp <site-url> [--token <bearer>]')
  process.exit(1)
}

const token = values.token ?? process.env.AFFORD_TOKEN
// the site index becomes the server's instructions; a site without one still works through afford_open
const index = await createClient(site, { token })
  .index()
  .catch(() => undefined)
await createServer(site, { token, instructions: index && describeSite(index) }).connect(
  new StdioServerTransport(),
)
