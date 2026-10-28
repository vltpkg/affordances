#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
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

await createServer(site, { token: values.token ?? process.env.AFFORD_TOKEN }).connect(
  new StdioServerTransport(),
)
