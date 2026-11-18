// How Chromium's WebMCP registers and unregisters a page's tools, which @affordances/webmcp's registration under a
// signal is built on (rfcs/architecture/webmcp.md). It needs no app: a page on http://localhost, intercepted in the
// browser, since modelContext needs a secure context. Run from the repo root:
//   node rfcs/research/0004-webmcp/registration.mjs <repo root>
// It prints the report as JSON, which registration.json records. Measured:
// - which methods modelContext has, and whether unregisterTool exists;
// - a second registerTool under a live name: whether it rejects, and which registration stays;
// - registerTool's second argument, { signal }: whether aborting it unregisters the tool;
// - registering the same name straight after an abort, as React's effect cleanup then effect does
import { createRequire } from 'node:module'
import path from 'node:path'

const [root] = process.argv.slice(2)
const require = createRequire(path.join(root, 'apps/hosting-lab/package.json'))
const { chromium } = require('@playwright/test')

const browser = await chromium.launch({ headless: true, args: ['--enable-features=WebMCP'] })
const page = await browser.newPage()
await page.route('http://localhost:9/**', (r) =>
  r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>registration</title>' }),
)
await page.goto('http://localhost:9/')
const report = await page.evaluate(async () => {
  const c = document.modelContext
  if (!c) return { modelContext: false }
  const tool = (name, d) => ({
    name,
    description: d,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: d }] }),
  })
  const listed = async (name) =>
    (await c.getTools()).filter((t) => t.name === name).map((t) => t.description)
  const settle = async (p) => {
    try {
      await p
      return 'resolved'
    } catch (e) {
      return `rejected: ${e.name}: ${e.message}`
    }
  }
  const out = {
    modelContext: true,
    methods: Object.keys(Object.getPrototypeOf(c)).toSorted(),
    unregisterTool: typeof c.unregisterTool,
  }
  // a duplicate name, with no signal
  out.first = await settle(c.registerTool(tool('dup', 'first')))
  out.duplicate = await settle(c.registerTool(tool('dup', 'second')))
  out.afterDuplicate = await listed('dup')
  // a signal, aborted
  const a = new AbortController()
  out.withSignal = await settle(c.registerTool(tool('sig', 'registered'), { signal: a.signal }))
  out.beforeAbort = await listed('sig')
  a.abort()
  out.afterAbort = await listed('sig')
  // the same name at once after an abort: React's cleanup, then its effect again
  const b = new AbortController()
  c.registerTool(tool('again', 'one'), { signal: b.signal })
  b.abort()
  out.reregisteredAfterAbort = await settle(
    c.registerTool(tool('again', 'two'), { signal: new AbortController().signal }),
  )
  out.afterReregister = await listed('again')
  return out
})
report.chromium = browser.version()
await browser.close()
console.log(JSON.stringify(report, null, 2))
