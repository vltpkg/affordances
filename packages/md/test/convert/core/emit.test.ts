import { htmlToMarkdown } from '../../../src/index.ts'
import { describe, expect, test } from 'vitest'
import { emit } from '../../../src/convert/core/emit.ts'
import {
  attentionAgrees,
  type Item,
  regexSafe,
  scannedSafe,
} from '../../../src/convert/core/emit-markdown.ts'
import type { Options, Result } from '../../../src/convert/core/types.ts'
import { corpusPages, fixturePages, type Page, similarity } from './emit-pages.ts'
import { parse } from '../../../src/convert/core/parse.ts'
import { both as fuzzBoth, generator } from './emit-fuzz.ts'
import { oracle } from './support/oracle.ts'

// emit's result for a page, and @affordances/md's for the same page: the target is the same bytes (and title, url
// and token count). a page is a body's content, or a whole document
const url = 'https://shop.test/page'
const document = (html: string) => (/<html|<body|<head/i.test(html) ? html : `<body>${html}</body>`)
const result = ({ markdown, title, url: link, tokens }: Result) => ({
  markdown,
  title,
  url: link,
  tokens,
})
const ours = (html: string, options: Options = {}) =>
  result(emit(oracle(document(html)), { url, ...options }))
const theirs = (html: string, options: Options = {}) =>
  result(htmlToMarkdown(document(html), { url, ...options }))

// every case above, for the parser's tree below
const collected: string[] = []
const collect = (pages: string[]) => {
  collected.push(...pages)
  return pages
}

describe('blocks', () => {
  test.each(
    collect([
      '<h1>Title</h1><h2>Two</h2><h3>Three</h3><h6>Six</h6>',
      '<p>one</p><p>two</p><hr><p>three</p>',
      '<h1>a<br>b</h1><h2>c<br>d</h2><h3>e<br>f</h3>',
      '<h2></h2><p></p><p><br></p><p><br>x<br></p>',
      '<blockquote><p>quoted</p><blockquote><p>nested</p></blockquote></blockquote>',
      '<blockquote>loose <b>text</b><ul><li>item</li></ul></blockquote>',
      '<div>text<div>block</div>more</div>',
      '<section><article><p>deep</p></article></section><aside>side</aside>',
      '<p>E = mc<sup>2</sup> and H<sub>2</sub>O</p><div>x<sup>1</sup>y</div>',
      '<p>a <q>quoted</q> b <q><em>em</em></q></p>',
      '<p>long<wbr>word</p>',
      '<center>old</center><font>font</font><big>big</big>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('lists', () => {
  test.each(
    collect([
      '<ul><li>a</li><li>b<ul><li>c</li><li>d</li></ul></li><li>e</li></ul>',
      '<ol><li>one</li><li>two</li></ol><ol start="3"><li>three</li></ol><ol start="0"><li>z</li></ol>',
      '<ol start="x"><li>a</li></ol><ol start="10"><li>ten</li><li>eleven</li></ol>',
      '<ul><li><p>loose</p></li><li><p>items</p></li></ul>',
      '<ul><li><div>a</div><ul><li>b</li></ul></li><li>c</li></ul>',
      '<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li><li><p><input type="checkbox"> in p</p></li></ul>',
      '<ul><li>a</li><ul><li>nested directly</li></ul><li>b</li></ul>',
      '<ul><li></li><li>after empty</li></ul>',
      '<p>lead</p><ul><li>a</li></ul><ul><li>second list</li></ul><ol><li>third</li></ol>',
      '<ul><li><hr></li><li>x</li></ul>',
      '<ul><li><pre><code>code\n  block</code></pre></li><li>b</li></ul>',
      '<ul><li><blockquote>q</blockquote></li></ul>',
      '<ol><li><ul><li><ul><li></li></ul></li></ul></li></ol>',
      '<dt>stray term</dt><dd>stray definition</dd>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('inline', () => {
  test.each(
    collect([
      '<p>Orders <strong>ship</strong> in <em>two</em> to <b>three</b> <i>days</i>, <del>free</del> <s>x</s> <code>flat</code>.</p>',
      '<p>foo<em>bar</em>baz <strong>a</strong><strong>b</strong> <em> spaced </em></p>',
      '<p><em>*</em> <strong>**</strong> <em>_</em> <b><i>both</i></b> <i><b>both</b></i></p>',
      '<p><em>a<em>b</em>c</em> <del>a<del>b</del>c</del> <strong>x <em>y</em> z</strong></p>',
      '<p>a<mark>m</mark><u>u</u><ins>i</ins><small>s</small><kbd>Ctrl</kbd><samp>out</samp><var>v</var><tt>t</tt></p>',
      '<p>code with <code>`ticks`</code> and <code>``double``</code> and <code> spaced </code> and <code>a|b</code></p>',
      '<p>a<br>b<br><br>c</p><p>line<br> after</p>',
      '<p><abbr title="x">ab</abbr> <time>noon</time> <cite>c</cite> <dfn>d</dfn> <span>s</span></p>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('escapes', () => {
  test.each(
    collect([
      '<p>*star* _under_ snake_case_name __dunder__ 2*3*4</p>',
      '<p>[brackets] and ![bang] and (parens) and a](b</p>',
      '<p>1. not a list</p><p>2) nor this</p><p>- dash</p><p>+ plus</p><p>* star</p><p># hash</p><p>&gt; quote</p>',
      '<p>= equals</p><p>~ tilde ~~strike~~</p><p>| pipe | x</p><p>`tick</p><p>&lt;div&gt; and &lt;3</p>',
      '<p>&amp;amp; &amp;copy; &amp;#38; A &amp; B</p>',
      '<p>back\\slash \\* \\_ and a\\</p>',
      '<p>www.example.com and https://example.com and me@example.com</p>',
      '<h2>www.example.com https://example.com me@example.com</h2>',
      '<h2>Ends with #</h2><h3># starts</h3><h2> </h2>',
      '<p>tab\there</p><p>  lead and trail  </p>',
      '<p>emoji 😀 and ünïcödé and 中文</p>',
      '<p>100% sure: 3 &lt; 4 &gt; 2, a_b_c, *a*b</p>',
      '<p>text <a href="/x">link</a>! and ![<a href="/y">img</a></p>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('links and images', () => {
  test.each(
    collect([
      '<p><a href="/rel">relative</a> <a href="../up">up</a> <a href="?q=1&amp;b=2">query</a> <a href="#frag">frag</a></p>',
      '<p><a href="https://example.com">https://example.com</a> <a href="mailto:me@x.test">me@x.test</a></p>',
      '<p><a href="https://example.com/a b">space</a> <a href="https://example.com/(paren)">paren</a> <a href="/a?b=(c)">p2</a></p>',
      '<p><a href="/t" title="A &quot;title&quot;">titled</a> <a href="javascript:alert(1)">js</a> <a href="#">top</a> <a href="">none</a></p>',
      '<p><a href="tel:+1">call</a> <a href="ftp://x.test">ftp</a> <a href="//cdn.test/x">proto</a> <a href="HTTPS://X.TEST/A">upper</a></p>',
      '<h2 id="s"><a href="#s">Section</a></h2><h3><a href="/other">Elsewhere</a></h3>',
      '<p><a href="/a"><img src="/i.png" alt="pic"></a> <a href="/b" aria-label="Label"><svg></svg></a> <a href="/c"></a></p>',
      '<p><a href="/a" title="T"><span></span></a> <a href="/same">x</a> <a href="/same">x</a> <a href="/same">y</a></p>',
      '<div><a href="/block"><div>block one</div><div>block two</div></a></div>',
      '<p><img src="/a.png" alt="described"> <img src="/b.png" alt=""> <img src="/c.png"> <img alt="no src"> <img src="data:x" alt="data"></p>',
      '<p><img src="/a.png" alt="with title" title="T"> <img src="https://cdn.test/x y.png" alt="space"></p>',
      '<p><a href="/x">[x]: y</a></p>',
      '<p><a href="https://x.test/%7Efoo">tilde</a> <a href="https://x.test:443/p">port</a> <a href="https://x.test/./a/../b">dots</a></p>',
      '<p><a href="/path#x">hash</a> <a href="https://x.test">bare</a> <a href="https://x.test?q">q</a> <a href="http://127.1/">ip</a></p>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('code', () => {
  test.each(
    collect([
      '<pre><code class="language-ts">const a = 1\n</code></pre>',
      '<pre><code>no language\n\n\n</code></pre>',
      '<pre data-language="py"><code>print(1)</code></pre><pre class="language-rb"><code>puts 1</code></pre>',
      '<pre><code class="language-js">a ``` b</code></pre>',
      '<pre><div>line one</div><div>line two</div></pre>',
      '<pre>a<br>b</pre><pre><span>  indented</span>\n<span>next</span></pre>',
      '<figure><figcaption>route.ts</figcaption><pre><code class="language-ts">x</code></pre></figure>',
      '<figure><pre><code class="language-ts">x</code></pre><figcaption>after</figcaption></figure>',
      '<div data-title="file.js"><pre><code class="language-js">y</code></pre></div>',
      '<pre data-title="t.ts"><code class="language-ts">z</code></pre>',
      '<listing>old\n  code</listing><xmp>raw <b>x</b></xmp>',
      '<pre><code class="language-a b">two classes</code></pre>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('tables', () => {
  test.each(
    collect([
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
      '<table><tr><td>headless</td><td>row</td></tr><tr><td>x</td><td>y</td></tr></table>',
      '<table><tr><th>first row th</th></tr><tr><td>x</td></tr></table>',
      '<table><tr><td>a</td><th>mixed</th></tr><tr><th>late</th><td>b</td></tr></table>',
      '<table><tr><th colspan="2">wide</th></tr><tr><td>a</td><td>b</td></tr></table>',
      '<table><tr><th>a</th><th>b</th></tr><tr><td rowspan="2">tall</td><td>1</td></tr><tr><td>2</td></tr></table>',
      '<table><tr><th align="right">r</th><th align="center">c</th><th align="left">l</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>',
      '<table><tr><th>h</th></tr><tr><td><p>para one</p><p>para two</p></td></tr></table>',
      '<table><tr><th>h</th></tr><tr><td><div>1,542</div><div>1,533</div></td></tr></table>',
      '<table><tr><th>h</th></tr><tr><td>a | b <code>c|d</code></td></tr></table>',
      '<table><tr><th>h</th></tr><tr><td><table><tr><td>in</td><td>ner</td></tr></table></td></tr></table>',
      '<table><tr><th>Status</th></tr><tr><td></td></tr></table><p>after skeleton</p>',
      '<table><tr><td></td></tr></table><table><caption>only caption</caption></table>',
      '<table><tr><th><button>Sort</button></th></tr><tr><td>v</td></tr></table>',
      '<table><tr><th>h</th></tr><tr><td>a<br>b</td></tr></table>',
      '<table><tr><td>uneven</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('details and definitions', () => {
  test.each(
    collect([
      '<details><summary>Returns</summary><p>Within 30 days.</p></details>',
      '<details><p>no summary</p></details><details><summary><b>bold</b> sum</summary>text</details>',
      '<dl><dt>Carrier</dt><dd>Post</dd><dt>Insured</dt><dd>Yes</dd></dl>',
      '<dl><dt>A</dt><dt>B</dt><dd>both</dd><div><dt>C</dt><dd>wrapped</dd></div></dl>',
      '<dl><dt>T</dt><dd><p>para</p><ul><li>list</li></ul>tail</dd><dd>no term</dd></dl>',
      '<dl><dt></dt><dd>empty term</dd></dl>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('whitespace', () => {
  test.each(
    collect([
      '<p>  many   spaces\n\nand\tlines  </p>',
      '<p>a <span> b </span> c</p><p><span>x</span> <span>y</span></p>',
      '<div>  <span>inline</span>  <div>block</div>  after </div>',
      '<p>nbsp&nbsp;&nbsp;kept&nbsp;</p>',
      '<p>before <img src="/i.png" alt="img"> after</p><p>x <input> y</p>',
      '<p><span>un</span><em>believ</em><span>able</span></p>',
      '<p>a<button>b</button>c <select><option>o</option></select> d</p>',
      '<td>stray cell</td><nobr>no  wrap</nobr>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('spacing', () => {
  test.each(
    collect([
      '<p><span>express</span><span>5.3.0</span> <span>$</span><span>48</span></p>',
      '<p><a href="/a">a</a><a href="/b">b</a> <span><a href="/c">c</a></span><span><a href="/d">d</a></span></p>',
      '<div style="display:flex">configure<span>vlt</span></div><div class="md:flex">x<span>y</span></div>',
      '<p><span class="block">yarn (zpm)</span><span class="block">6.0.0</span> <span style="display: block">5/6</span><span>fixtures</span></p>',
      '<p><span>H</span><span>e</span><span>l</span><span>l</span><span>o</span></p>',
      '<p><a href="/u"><img src="/a.png" alt="Ann"></a><a href="/u"><img src="/a.png" alt="Ann"></a> <a href="/u">x</a></p>',
      '<pre><code><span>no</span><span>space</span></code></pre><p><code><span>a</span><span>b</span></code></p>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('hidden', () => {
  test.each(
    collect([
      '<p>shown</p><p hidden>hidden</p><p aria-hidden="true">aria</p><p aria-hidden="false">kept</p>',
      '<p style="display:none">none</p><p style="visibility: hidden">vis</p><p style="content-visibility:hidden">cv</p><p style="opacity:0">kept</p>',
      '<p style="DISPLAY : NONE !important">caps</p><p style="display:/* c */none">comment</p><p style="d\\69splay:none">escape</p>',
      '<p style="visibility:collapse">collapse</p><p style="color:red">red kept</p>',
      '<div contenteditable>typed</div><div contenteditable="false">kept</div><div role="textbox">box</div>',
      '<p>a</p><div data-affordances-md="skip">skipped</div><p hidden data-affordances-md="show">shown for agents</p>',
      '<p>x<span hidden>gone</span>y</p>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

describe('extract', () => {
  test.each(
    collect([
      '<header><nav><a href="/">Home</a></nav></header><main><h1>Main</h1><p>content</p></main><footer>foot</footer>',
      '<div role="main"><p>role main</p></div><nav>nav</nav>',
      '<div role="main"><p>role</p></div><main><p>real main wins</p></main>',
      '<main><p>first</p></main><main><p>second</p></main>',
      '<div hidden><main><p>hidden main</p></main></div><p>body</p>',
      '<header>banner</header><div role="navigation">nav role</div><p>body only</p><aside>aside</aside><footer>f</footer>',
      '<div aria-hidden="true">x</div><div role="complementary">c</div><section><nav>inner nav</nav><p>kept</p></section>',
      'just text, no blocks <b>at all</b>',
    ]),
  )('%s', (html) => expect(ours(html)).toEqual(theirs(html)))
})

const whole = (head: string, body: string) =>
  `<html lang="en"><head>${head}</head><body>${body}</body></html>`
describe('the head', () => {
  test.each([
    whole('<title>Shipping notes</title>', '<p>no h1</p>'),
    whole('<title>Shipping notes</title>', '<h1>Shipping notes</h1><p>body</p>'),
    whole('<title>Cart · Acme</title>', '<h1>Cart</h1>'),
    whole('<title>Acme | Cart</title>', '<h1>Cart</h1>'),
    whole('<title>Cart: details</title>', '<h1>Cart</h1>'),
    whole('<title>Other</title>', '<h1>Heading <a href="https://x.test">https://x.test</a></h1>'),
    whole(
      '<meta name="description" content="How orders leave.">',
      '<h1>T</h1><p>How orders   leave.</p><p>next</p>',
    ),
    whole('<meta property="og:description" content="OG">', '<p>OG</p>'),
    whole(
      '<meta property="og:title" content="OG title"><meta property="og:image" content="/og.png">',
      '<p>x</p>',
    ),
    whole('<link rel="canonical" href="/canonical">', '<p>x</p>'),
    whole('<link rel="canonical" href="https://shop.test/a,b">', '<p>x</p>'),
    whole(
      '<script type="application/ld+json">{"@type": "Thing", "name": "x"}</script>',
      '<p>x</p>',
    ),
    whole('<script type="application/ld+json">not json ```</script>', '<p>x</p>'),
    whole('<title> Spaced  title </title>', '<h1>a<br>b</h1>'),
  ])('%s', (html) => expect(ours(html)).toEqual(theirs(html)))

  test('without frontmatter or json-ld', () => {
    const html = whole(
      '<title>T</title><meta name="description" content="d"><script type="application/ld+json">{}</script>',
      '<p>d</p>',
    )
    expect(ours(html, { frontmatter: false })).toEqual(theirs(html, { frontmatter: false }))
    expect(ours(html, { jsonLd: false })).toEqual(theirs(html, { jsonLd: false }))
  })
})

// a link hook: every page's twin, but one
const link = (target: URL) => (target.pathname === '/skip' ? undefined : `${target.href}.md`)
describe('options', () => {
  test('extract none keeps the chrome', () => {
    const html = '<nav>nav</nav><main><p>main</p></main>'
    expect(ours(html, { extract: 'none' })).toEqual(theirs(html, { extract: 'none' }))
  })
  test('the link hook relinks links, never images or fragments', () => {
    const html =
      '<p><a href="/a">a</a> <a href="#f">f</a> <img src="/i.png" alt="i"> <a href="/skip">s</a></p>'
    expect(ours(html, { link })).toEqual(theirs(html, { link }))
  })
  test('without a url, links stay as written', () => {
    const html = '<p><a href="/a">a</a> <img src="/i.png" alt="i"></p>'
    expect(ours(html, { url: undefined })).toEqual(theirs(html, { url: undefined }))
  })
})

// @affordances/md's own fixtures, each against its output (not the .md beside it, which the working tree may change
// before the package is built again)
const fixtures = fixturePages()
// known differences, all from what emit doesn't do yet, each with the share of its reference lines emit reproduces in
// order: markers and slots (<affordances-md>: main, text), the form summary, shown tab panels, streamed suspense
// boundaries. a page that gets closer should raise its floor; one that gets exact moves out of the list
const KNOWN = new Map([
  ['disclosure-fumadocs-tabs', 0.76],
  ['disclosure-radix-tabs', 0.76],
  ['form', 0.58],
  ['form-labels', 0.53],
  ['form-values', 0.33],
  ['main-markers', 0.99],
  ['markers', 0.66],
  ['package-page', 0.93],
  ['settings-form', 0.56],
  ['streamed-instructions', 0.68],
  ['streamed-next16.3', 0.46],
  ['streamed-product', 0.86],
  ['streamed-react19', 0.46],
])
const markdownOf = (page: Page) => ({
  ours: emit(oracle(page.html), { url: page.url }).markdown,
  reference: htmlToMarkdown(page.html, { url: page.url }).markdown,
})
describe('fixtures', () => {
  test.each(
    fixtures.filter((page) => !KNOWN.has(page.name)).map((page) => [page.name, page] as const),
  )('%s', (_, page) => {
    const { ours: written, reference } = markdownOf(page)
    expect(written).toBe(reference)
  })
  test.each(
    fixtures.filter((page) => KNOWN.has(page.name)).map((page) => [page.name, page] as const),
  )('%s, a known difference', (_, page) => {
    const { ours: written, reference } = markdownOf(page)
    expect(written).not.toBe(reference)
    expect(similarity(reference, written)).toBeGreaterThanOrEqual(KNOWN.get(page.name)!)
  })
})

// the benchmark corpus, when it's been fetched: byte for byte, every page
const corpus = corpusPages()
describe.skipIf(!corpus.length)('corpus parity', () => {
  test.each(corpus.map((page) => [page.name, page] as const))('%s', (_, page) => {
    const { ours: written, reference } = markdownOf(page)
    expect(written).toBe(reference)
  })
})

// the parser's tree must make the same markdown as the oracle's, whatever syntax the attributes are written in: the
// oracle always writes name="value", pages don't. each case again with its attributes uppercase, single-quoted,
// unquoted where they can be, spaced out, and repeated (the first one counts)
const ATTRIBUTE = /([\s])([a-z][a-z-]*)="([^"]*)"/g
const variants = (html: string) => [
  html.replace(ATTRIBUTE, (_, space, name, value) => `${space}${name.toUpperCase()}="${value}"`),
  html.replace(ATTRIBUTE, (_, space, name, value) =>
    value.includes("'") ? `${space}${name}="${value}"` : `${space}${name}='${value}'`,
  ),
  html.replace(ATTRIBUTE, (_, space, name, value) =>
    /^[^\s"'=<>`]+$/.test(value) ? `${space}${name}=${value}` : `${space}${name}="${value}"`,
  ),
  html.replace(ATTRIBUTE, (_, space, name, value) => `${space} ${name} =\t"${value}" `),
  html.replace(ATTRIBUTE, (_, space, name, value) => `${space}${name}="${value}" ${name}="x"`),
]
// whether the parser gives the contract's flags and mains yet (it's being written alongside)
const parsed = parse('<main hidden></main>')
const ready =
  parsed.mains !== undefined &&
  parsed.root.kids.some((kid) => typeof kid !== 'string' && kid.flags === 1)
const viaParser = (html: string) => emit(parse(document(html)), { url }).markdown
const viaOracle = (html: string) => emit(oracle(document(html)), { url }).markdown
describe.skipIf(!ready)("the parser's tree", () => {
  test.each(collected.flatMap(variants))('%s', (html) =>
    expect(viaParser(html)).toBe(viaOracle(html)),
  )
  test.each(corpus.map((page) => [page.name, page] as const))('%s', (_, page) =>
    expect(emit(parse(page.html), { url: page.url }).markdown).toBe(
      emit(oracle(page.html), { url: page.url }).markdown,
    ),
  )
})

// escaping by one scan over the text must say what the regexes say, in every construct it's used in
describe('escaping by scan', () => {
  const SCOPES = [
    ['phrasing'],
    ['phrasing', 'label', 'link'],
    ['phrasing', 'tableCell'],
    ['phrasing', 'strikethrough', 'emphasis'],
    ['phrasing', 'link', 'destinationRaw'],
    ['phrasing', 'link', 'destinationLiteral'],
    ['phrasing', 'link', 'titleQuote'],
    ['phrasing', 'image', 'label'],
    ['codeFencedLangGraveAccent'],
    ['codeFencedMetaGraveAccent'],
    ['phrasing', 'tableCell', 'link', 'label'],
  ]
  const ALPHABET = [
    'a',
    'b',
    '1',
    ' ',
    '\t',
    '_',
    '*',
    '[',
    ']',
    '(',
    ')',
    '!',
    '&',
    '#',
    '<',
    '>',
    '`',
  ]
  const MORE = [
    '~',
    '|',
    '\\',
    '-',
    '+',
    '.',
    '=',
    ':',
    '@',
    '"',
    "'",
    '/',
    '?',
    'é',
    '😀',
    'w',
    'p',
    's',
  ]
  const EDGES = [
    '',
    '\n',
    '[',
    ']',
    '_',
    '*',
    '**',
    '](',
    '|',
    ' ',
    'a',
    '!',
    '&',
    '<',
    '~',
    '\\',
    '(',
  ]
  // a fixed sequence of pseudo-random strings, so a failure repeats
  let seed = 7
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  const chars = [...ALPHABET, ...MORE]
  test('random texts, every scope and edge', () => {
    let checked = 0
    for (let round = 0; round < Number(process.env.ESCAPE_FUZZ ?? 20000); round++) {
      const scope = SCOPES[random(SCOPES.length)]!
      const length = 1 + random(8)
      let input = ''
      for (let i = 0; i < length; i++) input += chars[random(chars.length)]
      const before = EDGES[random(EDGES.length)]!
      const after = EDGES[random(EDGES.length)]!
      const encode = scope[0]!.startsWith('codeFenced') ? '`' : ''
      const scanned = scannedSafe(scope, input, before, after, encode)
      if (scanned === undefined) continue
      checked++
      expect([scope, input, before, after, scanned]).toEqual([
        scope,
        input,
        before,
        after,
        regexSafe(scope, input, before, after, encode),
      ])
    }
    expect(checked).toBeGreaterThan(10000)
  })
})

// the quick test that emphasis pairs as written must never pass what the full check rejects
describe('emphasis pairing shortcut', () => {
  let seed = 11
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  const TEXTS = [
    'a',
    'ab',
    ' ',
    ' a',
    'a ',
    '.',
    ',',
    '(',
    ')',
    '*',
    '_',
    'a.',
    '.a',
    '\\*',
    '1',
    'é',
    '😀',
    '',
  ]
  const SEQUENCES = [
    ['_', '*'],
    ['**', '__'],
    ['~~', '~'],
  ]
  const items = (depth: number): Item[] =>
    Array.from({ length: 1 + random(4) }, (): Item =>
      depth < 3 && random(3) === 0
        ? { children: items(depth + 1), sequences: SEQUENCES[random(3)]! }
        : TEXTS[random(TEXTS.length)]!,
    )
  test('random runs of text and emphasis', () => {
    const count = Number(process.env.ATTENTION_FUZZ ?? 20000)
    for (let round = 0; round < count; round++) {
      const list = items(0)
      const before = TEXTS[random(TEXTS.length)]! || '\n'
      const after = TEXTS[random(TEXTS.length)]! || '\n'
      expect([JSON.stringify(list), before, after, attentionAgrees(list, before, after)]).toEqual([
        JSON.stringify(list),
        before,
        after,
        true,
      ])
    }
  })
})

// the fast path's gate: with it and without it, the same markdown, for every case above, every page, and pages
// generated from the shapes it takes and their near misses (test/emit-fuzz.ts runs many more of those)
const withFast = (html: string, fast: boolean) =>
  emit(oracle(document(html)), { url, fast } as Options).markdown
describe('the fast path changes nothing', () => {
  test.each(collected)('%s', (html) => expect(withFast(html, true)).toBe(withFast(html, false)))
  test.each([...corpus, ...fixtures].map((page) => [page.name, page] as const))('%s', (_, page) => {
    const fast = emit(oracle(page.html), { url: page.url, fast: true } as Options).markdown
    expect(fast).toBe(emit(oracle(page.html), { url: page.url, fast: false } as Options).markdown)
  })
  test('generated pages', () => {
    const next = generator(42)
    for (let i = 0; i < Number(process.env.FAST_FUZZ ?? 3000); i++) {
      const html = next()
      const { fast, slow } = fuzzBoth(html)
      expect([html, fast]).toEqual([html, slow])
    }
    // nested lists make the generated pages longer: about 13 s for the 3000
  }, 60_000)
})
