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
  ['a strikethrough right in a list', '<ul><s>*a*', 'strikethrough and list'],
  ['in a dir', '<dir><del>_b_', 'strikethrough and list'],
  ['in an ol, beside text', '<ol>a<s>*b*</s>', 'strikethrough and list'],
  ['a list in a strikethrough', '<del><ul><s>x', 'strikethrough and list'],
  ['a break in a strikethrough in a list', '<dir><del><br>', 'strikethrough and list'],
  ['a form in a strikethrough', '<del><form><nobr>f\t', 'form in a link or strikethrough'],
  ['a form in a link', '<a href=/x><form><nobr>f\t</form></a>', 'form in a link or strikethrough'],
  // the tree pipeline converts a form with the table around it: a table in the form is flattened into the cell
  [
    'a form in a cell, with a table in it',
    '<table><td><form><table><td>out',
    'form in a table cell',
  ],
  [
    'a form in a cell, its spacing',
    '<table><td><form><span id="lbl">Labelled</span><span class="sr-only"><button role="tab" id="t1">Tab t1',
    'form in a table cell',
  ],
  [
    'a form in a header table',
    '<table><tr><th>F</th></tr><tr><td><form><input aria-label="B"></form></td></tr></table>',
    'form in a table cell',
  ],
  // text that doesn't wrap, split by a comment or a dropped element: the tree pipeline keeps both sides' whitespace
  [
    'a script splitting text in a nobr',
    '<nobr><</caption>\n\n<script></script>\t[l](u)&amp',
    'text split in a nobr',
  ],
  [
    'CDATA splitting text in a nobr',
    '<nobr>&#x0;\n\n<![CDATA[x<y]]> &#x110000;| t |',
    'text split in a nobr',
  ],
  ['a comment splitting text in a nobr', '<nobr>a <!-- c --> b</nobr>', 'text split in a nobr'],
  [
    'a comment splitting text in a nowrap cell',
    '<table><tr><td nowrap>a <!-- c --> b</td></tr></table>',
    'text split in a nobr',
  ],
  // a strikethrough with a list item in it, inside another
  ['a list item in nested strikethroughs', '<s><u><div><del><dd>', 'strikethrough and list'],
  [
    'a list item with text in nested strikethroughs',
    '<s><u><div><del><dd>x',
    'strikethrough and list',
  ],
  [
    'a search form in a cell',
    '<table><tr><td><form><input name="q"><button>Go</button></form></td></tr></table>',
    'form in a table cell',
  ],
])('declined: %s', (_, html, why) => {
  const { core, tree, declined } = both(html)
  expect({ core, declined }).toEqual({ core: tree, declined: [why] })
})

test('what real pages have still converts on md-core: a strikethrough in a list item, a card link with a header', () => {
  for (const html of [
    // a link labelled by what's in the chrome inside it, and whitespace before what's only for screen readers
    '<p><a href="/z" aria-labelledby="lbl"><header><span id="lbl">Labelled',
    '<strong><span id="lbl">Labelled</span><span class="sr-only"><img src="/i.png" alt=""><div role="navigation">LEAK',
    // text in a nobr with nothing splitting it, and a comment in text that wraps
    '<nobr>plain words</nobr>',
    '<p>a <!-- c --> b</p>',
    // chrome on a page without a main, stripped once prune has judged what's around it
    '<table><th><footer>&#x110000;',
    '<a><b><header>d',
    '<p>x</p><a href="/p"><header>Title</header></a><a href="/q" aria-labelledby="n"><svg></svg></a><nav id="n">Menu</nav>',
    '<h2><a href="/p"><nav>Docs</nav></a></h2><p>body</p>',
    '<table><tr><th>A</th></tr><tr><td><aside>note</aside></td></tr></table>',
    '<main><ul><li><s>$20</s> $15</li></ul></main>',
    '<main><a href="/p"><header>Title</header><p>Body</p></a></main>',
    '<main><h2>About</h2><pre>a\nb</pre></main>',
  ]) {
    const { core, tree, declined } = both(html)
    expect({ core, declined }).toEqual({ core: tree, declined: [] })
  }
})
