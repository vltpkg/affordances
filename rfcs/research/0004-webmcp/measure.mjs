// M7d: what WebMCP keeps of version 1, measured on hosting-lab in a real browser (RFC 0004 §6, assumption 9, as M7c
// measured MCP). Run against a served build, in Chromium with WebMCP on:
//   node measure.mjs <repo root, built> <port>
// It prints the report as JSON. Three things are measured:
// - tools: what the browser's tool list keeps of each tool the page registered (name, description, schema, hints);
// - generic: whether each generic tool's result is protocol 1's response, byte for byte, through the same session;
// - perCapability: what the browser keeps of every capability's tool, if each were registered (the shared core
//   registers only those open to anyone: exportable)
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [root, port] = process.argv.slice(2)
const require = createRequire(path.join(root, 'apps/hosting-lab/package.json'))
const { chromium } = require('@playwright/test')
const agent = await import(pathToFileURL(path.join(root, 'packages/runtime/dist/agent.js')).href)
const site = `http://localhost:${port}`
const base = '/api/projection'
const POLICY = 'exhaustive' // the page's view request (apps/hosting-lab/src/components/webmcp.tsx)

const browser = await chromium.launch({ headless: true, args: ['--enable-features=WebMCP'] })
const page = await browser.newPage()
await page.goto(`${site}/plans`)
// getTools() is async, so waitForFunction can't wait on it: its predicate would return a Promise, which is truthy at
// once. Poll it instead, until the page has registered its tools (after hydration)
for (let i = 0; ; i++) {
  if ((await page.evaluate(async () => (await document.modelContext.getTools()).length)) > 0) break
  if (i === 150) throw new Error('the page registered no WebMCP tools within 15 s')
  await page.waitForTimeout(100)
}

// a tool's call from outside the page, as a harness bridge makes it, and its text
const call = async (name, args) => {
  const raw = await page.evaluate(
    async ([n, a]) => {
      const tool = (await document.modelContext.getTools()).find((t) => t.name === n)
      return document.modelContext.executeTool(tool, a)
    },
    [name, args],
  )
  return JSON.parse(raw)
    .content.map((c) => c.text)
    .join('')
}
// protocol 1 itself, in the same page, so the same session
const direct = (op, init) =>
  page.evaluate(
    async ([url, i]) => (await fetch(url, { credentials: 'same-origin', ...i })).text(),
    [`${base}/${op}`, init],
  )
const post = (op, body) =>
  direct(op, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const differs = (a, b, at = '') =>
  a && b && typeof a === 'object' && typeof b === 'object'
    ? [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) =>
        differs(a[k], b[k], at ? `${at}.${k}` : k),
      )
    : JSON.stringify(a) === JSON.stringify(b)
      ? []
      : [at]
// equal as values, whatever the key order: the tool's text is the runtime's JSON re-serialized by the boundary, which
// orders keys its own way (a first run compared serializations, and counted key order as loss)
const same = (a, b) => differs(JSON.parse(a), JSON.parse(b)).length === 0

// 1. the tool list: what the browser keeps of each registered tool
const listed = await page.evaluate(async () =>
  (await document.modelContext.getTools()).map((t) => ({ ...t, window: undefined })),
)
const schemaOf = (s) => (typeof s === 'string' ? JSON.parse(s) : s)
const keep = (registered) => {
  const t = listed.find((l) => l.name === registered.name)
  if (!t) return { listed: false }
  return {
    listed: true,
    keys: Object.keys(t)
      .filter((k) => t[k] !== undefined)
      .toSorted(),
    name: t.name === registered.name,
    description: t.description === registered.description,
    inputSchema: JSON.stringify(schemaOf(t.inputSchema)) === JSON.stringify(registered.inputSchema),
    // each hint the page registered, kept (the same value listed) or dropped; and what the browser adds of its own
    hints: Object.fromEntries(
      Object.entries(registered.annotations ?? {}).map(([k, v]) => [
        k,
        t.annotations?.[k] === v ? 'kept' : 'dropped',
      ]),
    ),
    browserHints: Object.keys(t.annotations ?? {}).filter(
      (k) => !(k in (registered.annotations ?? {})),
    ),
  }
}
const tools = Object.fromEntries(agent.GENERIC_TOOLS.map((t) => [t.name, keep(t)]))

// 2. generic: each tool's result beside protocol 1's, for every start the views name and every offer
const results = []
const record = (op, args, a, b) =>
  results.push({
    op,
    args,
    same: same(a, b),
    differsAt: differs(JSON.parse(a), JSON.parse(b)).slice(0, 8),
  })
const starts = [undefined]
const first = JSON.parse(await direct(`view?policy=${POLICY}`))
for (const o of first.offers)
  if (o.target && !starts.some((s) => s && s.type === o.target.type && s.key === o.target.key))
    starts.push({ type: o.target.type, key: o.target.key })
const offers = new Set()
for (const start of starts) {
  const q = new URLSearchParams({
    policy: POLICY,
    ...(start && { start: `${start.type}:${start.key}` }),
  })
  const viaTool = await call('project', start ? { start } : {})
  const viaHttp = await direct(`view?${q}`)
  record('project', start ?? null, viaTool, viaHttp)
  const view = JSON.parse(viaHttp)
  for (const o of view.offers) offers.add(o.id)
  for (const e of view.omitted?.expand ?? []) {
    const args = { from: e.from, along: e.along }
    // the tool's expand runs on the start its last view was made from, as the direct request does here
    record(
      'expand',
      args,
      await call('expand', args),
      await post('expand', {
        ...args,
        policy: POLICY,
        ...(start && { start: `${start.type}:${start.key}` }),
      }),
    )
  }
  for (const id of view.offers.map((o) => o.id)) {
    const q2 = new URLSearchParams({
      offer: id,
      policy: POLICY,
      ...(start && { start: `${start.type}:${start.key}` }),
    })
    record(
      'inspect',
      { offer: id },
      await call('inspect', { offer: id }),
      await direct(`inspect?${q2}`),
    )
  }
}
// execute on a call that needs confirmation: the tool's refusal beside protocol 1's, which carries the token
const pro = first.offers.find(
  (o) => o.capability === 'hosting.plan.subscribe' && o.target?.key === 'p2',
)
await call('project', {})
const project = await page.evaluate(
  async () =>
    (await (await fetch('/api/projection/view?policy=exhaustive')).json()).offers.find(
      (o) => o.target?.type === 'hosting.project',
    )?.target?.key,
)
const input = { plan: 'p2', projectId: project }
const refusedTool = JSON.parse(await call('execute', { offer: pro.id, input }))
const refusedHttp = JSON.parse(await post('execute', { offer: pro.id, input, policy: POLICY }))
// the direct call is a second refusal, a moment later, so its token and expiry are its own: only approval is the
// boundary's doing, and the rest must match
const execute = {
  code: refusedTool.code,
  differsFromProtocol1At: differs(refusedTool, refusedHttp),
  approvalInTool: 'approval' in (refusedTool.confirmation ?? {}),
}

// 3. per-capability: every capability's tool, registered with a no-op execute, and what the list keeps of it
const manifest = await page.evaluate(async () =>
  (await fetch('/.well-known/affordances/manifest.json')).json(),
)
const all = manifest.capabilities.filter((c) => c.kind !== 'event').map(agent.capabilityTool)
const exportable = new Set(agent.exportable(manifest).map((c) => c.id))
await page.evaluate((defs) => {
  for (const d of defs)
    document.modelContext.registerTool({ ...d, execute: async () => ({ content: [] }) })
}, all)
listed.splice(
  0,
  listed.length,
  ...(await page.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => ({ ...t, window: undefined })),
  )),
)
const perCapability = all.map((t) => ({
  capability: t.name,
  exportedByTheCore: exportable.has(t.name),
  ...keep(t),
}))

await browser.close()
const tally = (rows, f) => rows.filter(f).length
console.log(
  JSON.stringify(
    {
      browser: {
        name: 'chromium',
        version: browser.version(),
        flags: ['--enable-features=WebMCP'],
        headless: true,
      },
      policy: POLICY,
      tools,
      generic: {
        calls: results.length,
        sameAsProtocol1: tally(results, (r) => r.same),
        differ: results.filter((r) => !r.same),
        execute,
      },
      perCapability: {
        capabilities: perCapability.length,
        exportedByTheCore: exportable.size,
        listed: tally(perCapability, (r) => r.listed),
        descriptionKept: tally(perCapability, (r) => r.description),
        inputSchemaKept: tally(perCapability, (r) => r.inputSchema),
        hints: perCapability.reduce((n, r) => {
          for (const [k, f] of Object.entries(r.hints ?? {}))
            n[k] = { ...n[k], [f]: (n[k]?.[f] ?? 0) + 1 }
          return n
        }, {}),
        rows: perCapability,
      },
    },
    null,
    2,
  ),
)
