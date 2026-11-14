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

// md-core now writes these as the tree pipeline does
test.each([
  // an <html> in svg or math is a foreign element, never the root: its lang isn't the page's
  ['<html lang> in svg', '<p>x</p><svg><html lang="fr">'],
  ['<html lang> in math', '<p>x</p><math><html lang="fr">'],
  // a <nobr> doesn't wrap, in a <pre> too: its whitespace collapses
  ['a nobr in a pre', '<pre><nobr>Two words\r\n'],
  ['a nobr in a listing', '<listing><nobr>a\t b'],
  // an h1 or h2 that holds a line ending anywhere, a code block's too, is written setext style
  ['an xmp in an h2', '<h2><xmp>\n\n--'],
  ['a pre in an h1', '<h1><pre>a\nb'],
  ['a plaintext in an h2', '<h2><plaintext>\nr'],
  // html right after a line ending is written after a space instead: a hard break before an <AgentText>
  ['a break before an AgentText', '<br><affordances-md data-mode="text" data-md="said">'],
  [
    'a break before an AgentText, in a paragraph',
    '<p>a<br><affordances-md data-mode="text" data-md="said"></affordances-md>b</p>',
  ],
  [
    'a break before an empty AgentText',
    '<p>a<br><affordances-md data-mode="text" data-md=""></affordances-md>b</p>',
  ],
  [
    'a break before an empty AgentText, in emphasis',
    '<em><br><affordances-md data-mode="text" data-md="">',
  ],
  [
    'an AgentText before a break',
    '<p><affordances-md data-mode="text" data-md="said"></affordances-md><br>b</p>',
  ],
  [
    'a break before a block AgentText',
    '<p>a<br><affordances-md data-mode="text" data-block data-md="**blk**"></affordances-md></p>',
  ],
  [
    'a break before an html AgentText',
    '<p>a<br><affordances-md data-mode="text" data-md="<sup>1</sup>">',
  ],
])('fixed: %s', (_, html) => {
  for (const options of [{}, { url: 'https://site.test/a/b' }, { slots: { a: 'FILLED' } }]) {
    const { core, tree, declined } = both(html, options)
    expect({ core, declined }).toEqual({ core: tree, declined: [] })
  }
})
