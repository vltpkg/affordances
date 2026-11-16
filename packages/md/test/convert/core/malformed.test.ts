import { afterEach, expect, test } from 'vitest'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { both } from './support/paths.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

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

// text a comment splits (react writes <!-- --> between adjacent texts), or an element md never reads: the tree
// pipeline keeps the texts apart, so a box beside them is spaced by the nearest text's own word, not the joined one's
test.each([
  ['a comment, then a block span', '<p>S<!-- -->5<span class="block">pa</span></p>'],
  ['a comment, then a flex span', '<p>S <!---->5<span class="flex">partial</span></p>'],
  [
    'comments in a cell',
    '<table><tr><th>a</th></tr><tr><td>Search<!-- --> ×<!-- --> <!-- -->5<span class="block">partial</span></td></tr></table>',
  ],
  ['a comment, a box before', '<i class="block">pa) S</i>:<!-- --> v '],
  ['a comment, a flex box after', '5<!---->(<b class="flex">:中文</b>'],
  [
    'an empty hidden svg, a box after',
    '5 <svg viewBox="0 0 1 1" aria-hidden="true"></svg>:<b class="block">npm× </b>',
  ],
  [
    'an empty hidden svg, a box before',
    '<span class="md:flex">× ,×</span>5<svg aria-hidden="true"></svg>)',
  ],
  ['a box ending in a no-break space', '<i class="flex">pa&nbsp;</i>× <!-- -->5S'],
  ['a script', '<p>S<script>x</script>5<span class="block">pa</span></p>'],
  ['a react boundary comment', '<p>S<!--$-->5<span class="block">pa</span><!--/$--></p>'],
  [
    'a comment before a table, fostered text after',
    '<p>ab<!-- --><table>cd<tr><td>x</td></tr></table></p>',
  ],
  // each a comment in the table after the one in its parent, then text fostered out of it: the parent's split stands
  [
    'a comment, then one in a table, fostered text after',
    '<div><i class="block">pa) S</i>:<!-- --><table><!---->v<tr><td>x</td></tr></table></div>',
  ],
  [
    'a comment, then one in a row, fostered text after',
    '<div><i class="block">pa) S</i>:<!-- --><table><tr><!----><td>x</td></tr>v</table></div>',
  ],
  [
    'a comment, then one in a caption, fostered text after',
    '<div><i class="block">pa) S</i>:<!-- --><table><caption>c<!----></caption><tr><td>x</td></tr>v</table></div>',
  ],
])('text split by %s, beside a box', (_, html) => {
  for (const options of [{}, { url: 'https://site.test/a/b' }, { link: (url: URL) => url.href }]) {
    const { core, tree, declined } = both(`<main>${html}</main>`, options)
    expect({ core, declined }).toEqual({ core: tree, declined: [] })
  }
})

// the head's canonical link, as the tree pipeline reads it: rel is one token, with any whitespace around it
test.each([
  ['a space before', ' canonical'],
  ['a line ending after', 'canonical\n'],
  ['a no-break space before', ' canonical'],
  ['a second token', 'canonical alternate'],
  ['another case', 'Canonical'],
])('a canonical rel with %s', (_, rel) => {
  const html = `<html><head><link rel="${rel}" href="https://site.test/c"></head><body><p>hi</p></body></html>`
  const { core, tree, declined } = both(html, { url: 'https://site.test/a/b' })
  expect({ core, declined }).toEqual({ core: tree, declined: [] })
})

// the head's first canonical link is its canonical, href or not: one without a usable href leaves the url option's
test.each([
  ['no href', '<link rel="canonical">'],
  ['an empty href', '<link rel="canonical" href="">'],
  ['a blank href', '<link rel="canonical" href=" ">'],
  ['an href', '<link rel="canonical" href="/first">'],
])('a first canonical with %s, then another', (_, first) => {
  const html = `<html><head>${first}<link rel="canonical" href="/second"></head><body><p>hi</p></body></html>`
  const { core, tree, declined } = both(html, { url: 'https://site.test/a/b' })
  expect({ core, declined }).toEqual({ core: tree, declined: [] })
  expect(core).not.toContain('/second')
})
