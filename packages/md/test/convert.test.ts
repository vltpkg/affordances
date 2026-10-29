import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { htmlToMarkdown } from '../src/index.ts'

const dir = new URL('./fixtures/', import.meta.url)
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.html'))

// golden files: fixtures/<name>.html → fixtures/<name>.md (vitest -u rewrites them; review the diff)
test.each(fixtures)('%s', async (file) => {
  const html = readFileSync(new URL(file, dir), 'utf8')
  const { markdown } = htmlToMarkdown(html, { url: 'https://shop.test/page' })
  await expect(markdown).toMatchFileSnapshot(`fixtures/${file.replace(/\.html$/, '.md')}`)
})

test('never outputs values, tokens, scripts, comments, or data attributes', () => {
  const all = fixtures
    .map((f) => htmlToMarkdown(readFileSync(new URL(f, dir), 'utf8')).markdown)
    .join('\n')
  for (const secret of [
    'tok_9f8a7b6c',
    'hunter2',
    'jane@example.com',
    'SAVE20',
    'private note',
    'window.secret',
    'deploy 42',
    'data-tracking',
    'onclick',
    'color: red',
  ])
    expect(all).not.toContain(secret)
})

test('is deterministic, and counts tokens', () => {
  const html = readFileSync(new URL('article.html', dir), 'utf8')
  const a = htmlToMarkdown(html)
  expect(htmlToMarkdown(html)).toEqual(a)
  expect(a.title).toBe('Shipping notes')
  expect(a.tokens).toBe(Math.ceil(a.markdown.length / 4))
})

test('options: no frontmatter, no JSON-LD, extract none, custom handlers', () => {
  const html = readFileSync(new URL('article.html', dir), 'utf8')
  const plain = htmlToMarkdown(html, { frontmatter: false, jsonLd: false }).markdown
  expect(plain.startsWith('# Shipping notes')).toBe(true)
  expect(plain).not.toContain('schema.org')
  expect(htmlToMarkdown(html, { extract: 'none' }).markdown).toContain('© 2026 Afford Supply')
  const custom = htmlToMarkdown(html, {
    handlers: { blockquote: () => ({ type: 'text', value: 'QUOTE' }) as never },
  })
  expect(custom.markdown).toContain('QUOTE')
})
