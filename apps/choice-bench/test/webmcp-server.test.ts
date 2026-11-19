import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { WebMcpRecord } from '../src/webmcp-server.ts'

// the WebMCP bridge's wait (the planner, 17:26Z), against a small site of its own with WebMCP on: it waits, bounded,
// for the page's tools, and a timeout or an empty list is a harness fault it records, never a crash

const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-webmcp-'))
let site: Server
let url = ''
// '/' registers one tool 300ms after load, as hydration does; '/none' never registers any
const page = (register: boolean) => `<main><h1>Home</h1></main><script>
  ${register ? `setTimeout(() => document.modelContext.registerTool({ name: 'project', description: 'See the actions', inputSchema: { type: 'object', properties: {} }, execute: async () => JSON.stringify({ content: [{ type: 'text', text: '{}' }] }) }), 300)` : ''}
</script>`
beforeAll(async () => {
  site = createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(page(req.url !== '/none'))
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
})
afterAll(() => {
  site.close()
  rmSync(dir, { recursive: true, force: true })
})

const bridge = async (name: string, siteUrl: string) => {
  const out = path.join(dir, `${name}.json`)
  const config = path.join(dir, `${name}.config.json`)
  writeFileSync(
    config,
    JSON.stringify({ url: siteUrl, session: 's_wm', out, toolsTimeoutMs: 1500 }),
  )
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(import.meta.dirname, '..', 'src', 'webmcp-server.ts'), config],
    }),
  )
  return { client, record: () => JSON.parse(readFileSync(out, 'utf8')) as WebMcpRecord }
}

test(
  'the bridge waits for the page’s tools, bounded, and lists them once they register',
  { timeout: 120_000 },
  async () => {
    const b = await bridge('registers', url)
    try {
      expect((await b.client.listTools()).tools.map((t) => t.name)).toEqual(['project'])
    } finally {
      await b.client.close()
    }
    expect(b.record().harnessFaults).toEqual([])
    expect(b.record()).not.toHaveProperty('errors')
  },
)

test(
  'a page that registers no tools: the wait times out and the empty list is a recorded fault, not a crash',
  { timeout: 120_000 },
  async () => {
    // a site whose every page registers nothing: the bridge opens '/', so this one answers '/' with the empty page
    const empty = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(page(false))
    })
    await new Promise<void>((resolve) => empty.listen(0, '127.0.0.1', resolve))
    const b = await bridge('none', `http://127.0.0.1:${(empty.address() as AddressInfo).port}`)
    try {
      // the bridge still answers, so the record is written and the runner sets the trial aside
      expect((await b.client.listTools()).tools).toEqual([])
    } finally {
      await b.client.close()
      empty.close()
    }
    expect(b.record().harnessFaults.map((e) => [e.kind, e.tool])).toEqual([
      ['page-tools', 'wait'],
      ['page-tools', 'tools/list'],
    ])
    expect(b.record().harnessFaults[0]!.detail).toMatch(/registered no tools within 1500ms/)
  },
)
