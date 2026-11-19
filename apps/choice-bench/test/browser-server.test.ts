import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { BrowserRecord } from '../src/browser-server.ts'

// the browser surface's server, against a small site of its own (the planner, 15:11Z): the session is an HttpOnly
// cookie no tool result shows, the context is confined to the trial's origin, and the record has what the trace needs

const dir = mkdtempSync(path.join(tmpdir(), 'choice-bench-browser-'))
const SESSION = 's_browser_secret_7'
let site: Server
let url = ''
const cookiesSeen: string[] = []
const pathsSeen: string[] = []
beforeAll(async () => {
  site = createServer((req, res) => {
    cookiesSeen.push(req.headers.cookie ?? '')
    pathsSeen.push(req.url ?? '')
    res.setHeader('content-type', 'text/html')
    if (req.url === '/away') return res.end('<h1>Elsewhere</h1>')
    // the app's Confirm in miniature: a slow server request, then a client-side navigation with no new document
    if (req.url === '/slow') return void setTimeout(() => res.end('ok'), 600)
    if (req.url === '/confirm')
      return res.end(`<main><h1>Review</h1><button id="go">Confirm</button></main><script>
        document.getElementById('go').onclick = async () => {
          await fetch('/slow')
          history.pushState({}, '', '/after')
          document.body.innerHTML = '<main><h1>After</h1></main>'
        }
      </script>`)
    // another origin: an image, and a link a click would follow
    res.end(`<main><h1>Home</h1>
      <img alt="tracker" src="http://localhost:${(site.address() as AddressInfo).port}/pixel">
      <a href="http://localhost:${(site.address() as AddressInfo).port}/away">Leave</a>
      <p id="c"></p><script>document.getElementById('c').textContent = 'script sees: [' + document.cookie + ']'</script>
      <form><input aria-label="Note"><button type="submit">Send</button></form></main>`)
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
})
afterAll(() => {
  site.close()
  rmSync(dir, { recursive: true, force: true })
})

test(
  'five tools; the session an HttpOnly cookie no result shows; nothing reaches another origin',
  { timeout: 120_000 },
  async () => {
    const out = path.join(dir, 'browser.json')
    const config = path.join(dir, 'config.json')
    writeFileSync(config, JSON.stringify({ url, session: SESSION, out }))
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(import.meta.dirname, '..', 'src', 'browser-server.ts'), config],
      }),
    )
    // closed however the checks go, so no browser server outlives a failed run
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name)
      expect(tools.toSorted()).toEqual(['click', 'fill', 'open', 'snapshot', 'submit'])
      const text = async (name: string, args: Record<string, unknown> = {}) => {
        const r = (await client.callTool({ name, arguments: args })) as {
          content: { text: string }[]
          isError?: boolean
        }
        return { text: r.content[0]!.text, isError: r.isError === true }
      }
      const home = await text('open', { path: '/' })
      expect(home.text).toContain('heading "Home"')
      // the page's own script reads no session: the cookie is HttpOnly
      expect(home.text).toContain('script sees: []')
      // the agent can't open another origin, and a link to one goes nowhere
      expect((await text('open', { path: 'http://localhost:1/' })).isError).toBe(true)
      const leave = home.text.match(/link "Leave" \[ref=(\w+)\]/)![1]
      const after = await text('click', { ref: leave })
      expect(after.text).toMatch(/off the site, so it wasn’t followed/)
      expect(after.text).toContain('heading "Home"')
      // a ref the agent made up is its own mistake, told to it, never a stall
      expect(await text('click', { ref: 'e999' })).toMatchObject({
        isError: true,
        text: expect.stringMatching(/No element has ref e999/),
      })
    } finally {
      await client.close()
    }
    const record = JSON.parse(readFileSync(out, 'utf8')) as BrowserRecord
    // the server got the session; no tool result, and nothing in the record, carries it
    expect(cookiesSeen.some((c) => c.includes(`sid=${SESSION}`))).toBe(true)
    expect(JSON.stringify(record)).not.toContain(SESSION)
    expect(record.sessionCookie).toEqual({ name: 'sid', httpOnly: true, sameSite: 'Lax' })
    // every request to the other origin was aborted and recorded: the link's once, and the image each time the page
    // loaded (going back reloads it); and the site never saw either
    expect(record.aborted.every((a) => new URL(a.url).origin !== url)).toBe(true)
    expect(record.aborted.filter((a) => new URL(a.url).pathname === '/away')).toHaveLength(1)
    expect(record.aborted.some((a) => new URL(a.url).pathname === '/pixel')).toBe(true)
    expect(pathsSeen.filter((p) => p === '/away' || p === '/pixel')).toEqual([])
    expect(cookiesSeen.length).toBe(cookiesSeen.filter((c) => c.includes('sid=')).length)
    // what the trace needs: the browser's versions, and no flags, so no WebMCP
    expect(record.chromium).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    expect(record.playwright).toBe('1.64.1')
    expect(record.launchArgs).toEqual([])
    expect(record.harnessFaults).toEqual([])
    expect(record).not.toHaveProperty('stalls')
    expect(record).not.toHaveProperty('errors')
  },
)

// the settle-wait (the re-pilot's one fault; intake, 19:35Z): a click whose action navigates on the client after a
// slow request returns the page it settled on, never the one before, and records how long it waited
test(
  'a click that navigates client-side after a slow request returns the settled page, with its settle time',
  { timeout: 120_000 },
  async () => {
    const out = path.join(dir, 'settle.json')
    const config = path.join(dir, 'settle-config.json')
    writeFileSync(config, JSON.stringify({ url, session: SESSION, out }))
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.join(import.meta.dirname, '..', 'src', 'browser-server.ts'), config],
      }),
    )
    try {
      const text = async (name: string, args: Record<string, unknown> = {}) =>
        ((await client.callTool({ name, arguments: args })) as { content: { text: string }[] })
          .content[0]!.text
      const review = await text('open', { path: '/confirm' })
      const ref = review.match(/button "Confirm" \[ref=(\w+)\]/)![1]
      const after = await text('click', { ref })
      expect(after.split('\n')[0]).toBe('Page: /after')
      expect(after).toContain('heading "After"')
      expect(after).not.toContain('button "Confirm"')
    } finally {
      await client.close()
    }
    const calls = (JSON.parse(readFileSync(out, 'utf8')) as BrowserRecord).calls
    const click = calls.find((c) => c.tool === 'click')!
    // it waited out the 600 ms request and the quiet window after it, well inside the bound
    expect(click.settleMs).toBeGreaterThanOrEqual(600)
    expect(click.settleTimedOut).toBe(false)
    expect(calls.find((c) => c.tool === 'open')!.settleMs).toBeGreaterThanOrEqual(300)
  },
)
