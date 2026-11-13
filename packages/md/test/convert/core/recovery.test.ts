import { afterEach, expect, test } from 'vitest'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { htmlToMarkdown, readPage, type Options } from '../../../src/index.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

// a malformed page through md on both paths (htmlToMarkdown, and readPage with a fill): what md-core writes, what the
// tree pipeline writes, and why md-core declined it, if it did
const read = (html: string, options: Options) => {
  const page = readPage(html, options)
  const { markdown, ...rest } = page
  return JSON.stringify([htmlToMarkdown(html, options), rest, markdown({ a: 'F' })])
}
const both = (html: string, options: Options = {}) => {
  forcePath('hast')
  const tree = read(html, options)
  forcePath('core')
  declines.clear()
  const core = read(html, options)
  return { core, tree, declined: [...declines.keys()] }
}

// md-core declines these: the tree pipeline prunes the page in place before it reads it, and what it finds there
// depends on what it pruned first; and it writes a strikethrough outside a paragraph (right in a list, or around
// one), where what's escaped isn't what md-core escapes
test.each([
  ['a main in a link', 'text<a href="/y"><main>', 'main inside what prune changes'],
  ['a main in a heading', '<h1><meter><main>', 'main inside what prune changes'],
  ['a main in a caption', '<table><caption><main>&amp', 'main inside what prune changes'],
  [
    'a main in a link in a listing',
    '<listing><a href="/y"><main>',
    'main inside what prune changes',
  ],
  ['chrome in a header cell', '<table><th><footer>&#x110000;', 'chrome inside what prune changes'],
  ['chrome in a link', '<a><b><header>d', 'chrome inside what prune changes'],
  ['a strikethrough right in a list', '<ul><s>*a*', 'strikethrough and list'],
  ['in a dir', '<dir><del>_b_', 'strikethrough and list'],
  ['in an ol, beside text', '<ol>a<s>*b*</s>', 'strikethrough and list'],
  ['a list in a strikethrough', '<del><ul><s>x', 'strikethrough and list'],
  ['a break in a strikethrough in a list', '<dir><del><br>', 'strikethrough and list'],
])('declined: %s', (_, html, why) => {
  const { core, tree, declined } = both(html)
  expect({ core, declined }).toEqual({ core: tree, declined: [why] })
})

test('what real pages have still converts on md-core: a strikethrough in a list item, a card link with a header', () => {
  for (const html of [
    '<main><ul><li><s>$20</s> $15</li></ul></main>',
    '<main><a href="/p"><header>Title</header><p>Body</p></a></main>',
    '<main><h2>About</h2><pre>a\nb</pre></main>',
  ]) {
    const { core, tree, declined } = both(html)
    expect({ core, declined }).toEqual({ core: tree, declined: [] })
  }
})
