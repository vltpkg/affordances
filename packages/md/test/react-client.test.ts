import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { OPEN_IN_MAX, openInHrefs, usePageMarkdown } from '../src/react/client.ts'

// the hook's functions, from one render; they work after it, the way an event handler calls them
const hook = (path: string, options?: Parameters<typeof usePageMarkdown>[1]) => {
  let result!: ReturnType<typeof usePageMarkdown>
  const Probe = () => {
    result = usePageMarkdown(path, options)
    return null
  }
  renderToString(h(Probe))
  return result
}

let respond: () => Response
let calls: { url: string; init: RequestInit }[]
beforeEach(() => {
  calls = []
  respond = () => new Response('# Tee\n', { headers: { 'content-type': 'text/markdown' } })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return respond()
  })
})
afterEach(() => vi.unstubAllGlobals())

test('fetches the twin once, for preload and load alike', async () => {
  const { load, preload } = hook('/products/tee')
  preload()
  expect(await load()).toBe('# Tee\n')
  expect(calls).toEqual([{ url: '/products/tee.md', init: { credentials: 'same-origin' } }])
  await load()
  expect(calls).toHaveLength(1)
})

test('the home page is /index.md, and the public page can be asked for', async () => {
  await hook('/', { credentials: 'omit' }).load()
  expect(calls).toEqual([{ url: '/index.md', init: { credentials: 'omit' } }])
})

test('refuses an error or a response that is not markdown, and forgets it so the next call retries', async () => {
  const { load } = hook('/a')
  respond = () => new Response('<html>', { headers: { 'content-type': 'text/html' } })
  await expect(load()).rejects.toThrow('/a.md: not markdown')
  respond = () => new Response('', { status: 500 })
  await expect(load()).rejects.toThrow('/a.md: 500')
  respond = () =>
    new Response('# A\n', { headers: { 'content-type': 'text/markdown; charset=utf-8' } })
  expect(await load()).toBe('# A\n')
  expect(calls).toHaveLength(3)
})

test('refuses a path on another origin, and never fetches it', async () => {
  // a backslash is a slash to a url parser: /\evil.test/x is //evil.test/x
  for (const path of ['//evil.test/x', 'https://evil.test/x', '/\\evil.test/x'])
    await expect(hook(path).load()).rejects.toThrow("not this site's page")
  vi.stubGlobal('location', { origin: 'https://shop.test' })
  await expect(hook('https://evil.test/x').load()).rejects.toThrow("not this site's page")
  expect(await hook('https://shop.test/x').load()).toBe('# Tee\n')
  expect(calls).toEqual([{ url: 'https://shop.test/x.md', init: { credentials: 'same-origin' } }])
})

test('a failed preload stays quiet', async () => {
  respond = () => new Response('', { status: 404 })
  const { preload } = hook('/a')
  expect(preload()).toBeUndefined()
  await vi.waitFor(() => expect(calls).toHaveLength(1))
})

test('openInHrefs builds each link, with its own Claude Code prompt and the q limit', () => {
  const links = openInHrefs({ prompt: 'Read https://x.test/a.md', claudeCode: 'Ask first' })
  expect(links).toEqual({
    claude: 'https://claude.ai/new?q=Read%20https%3A%2F%2Fx.test%2Fa.md',
    chatgpt: 'https://chatgpt.com/?hints=search&q=Read%20https%3A%2F%2Fx.test%2Fa.md',
    claudeCode: 'claude-cli://open?q=Ask%20first',
  })
  // only claude-cli:// has the cap; the web apps get the whole prompt
  const long = openInHrefs({ prompt: 'a'.repeat(OPEN_IN_MAX + 10) })
  expect(long.claudeCode).toBe(`claude-cli://open?q=${'a'.repeat(OPEN_IN_MAX)}`)
  expect(long.claude).toBe(`https://claude.ai/new?q=${'a'.repeat(OPEN_IN_MAX + 10)}`)
  // an emoji across the cap is dropped whole, not split into a half that can't be encoded
  const emoji = openInHrefs({ prompt: `${'a'.repeat(OPEN_IN_MAX - 1)}😀` })
  expect(emoji.claudeCode).toBe(`claude-cli://open?q=${'a'.repeat(OPEN_IN_MAX - 1)}`)
})
