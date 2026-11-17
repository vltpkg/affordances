import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import { Declined, forcePath } from '../../../src/convert/path.ts'
import { htmlToMarkdown } from '../../../src/index.ts'

afterEach(() => forcePath(undefined))

const dir = new URL('../../fixtures/', import.meta.url)
const fixtures = readdirSync(dir)
  .filter((file) => file.endsWith('.html'))
  .map((file) => [file, readFileSync(new URL(file, dir), 'utf8')] as const)

// the urls the link option is asked about, in order, and the markdown
const asked = (html: string) => {
  const seen: string[] = []
  const { markdown } = htmlToMarkdown(html, {
    url: 'https://shop.test/page',
    link: (url) => {
      seen.push(url.href)
      return `${url.href}.md`
    },
  })
  return { seen, markdown }
}

test.each([
  [
    'a block the fast path declines after its links',
    '<p><a href="/a">A</a> <a href="#top">Top</a> <img src="/i.png" alt="i"> <a href="/b">B</a></p>',
  ],
  [
    'a block right after the h1, read again for the description',
    '<head><meta name="description" content="A"></head><h1>T</h1><p><a href="/a">A</a></p>',
  ],
  [
    'a list written as it is read',
    '<ul><li><a href="/a">A</a></li><li><a href="/b">B</a> <span class="x">y</span></li></ul>',
  ],
  ['the same url twice', '<p><a href="/a">One</a> and <a href="/a">two</a></p>'],
])('the link option is asked once per link, in order: %s', (_, html) => {
  forcePath('hast')
  const tree = asked(html)
  forcePath('strict')
  expect(asked(html)).toEqual(tree)
})

test('and over every fixture md-core writes', () => {
  let compared = 0
  for (const [, html] of fixtures) {
    forcePath('hast')
    const tree = asked(html)
    forcePath('strict')
    try {
      expect(asked(html)).toEqual(tree)
      compared++
    } catch (error) {
      if (!(error instanceof Declined)) throw error
    }
  }
  expect(compared).toBeGreaterThan(fixtures.length / 2)
})
