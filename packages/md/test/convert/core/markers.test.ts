import { expect, test } from 'vitest'
import { declines, forcePath } from '../../../src/convert/path.ts'
import type { Options } from '../../../src/index.ts'
import { htmlToMarkdown as coreMarkdown } from '../../../src/convert/core/index.ts'
import { htmlToMarkdown, readPage } from '../../../src/index.ts'
import { markerPages } from './marker-fuzz.ts'

// md-core against the tree pipeline, on what markers keep and leave out
const same = (html: string) =>
  expect(coreMarkdown(html, { url: 'https://shop.test/page' }).markdown).toBe(
    htmlToMarkdown(html, { url: 'https://shop.test/page' }).markdown,
  )

test('on an element that is not a marker, data-affordances-md keeps nothing hidden but show', () => {
  for (const mode of ['only', 'main', 'text', 'slot', 'values', ''])
    for (const hide of ['hidden', 'style="display:none"', 'aria-hidden="true"']) {
      same(`<main><p>a</p><div ${hide} data-affordances-md="${mode}">LEAK</div></main>`)
      same(`<p>a</p><nav ${hide} data-affordances-md="${mode}">LEAK</nav>`)
    }
  // chrome stays out of a page without a main, unless it's shown
  same(
    '<p>a</p><nav data-affordances-md="only">LEAK</nav><nav data-affordances-md="show">kept</nav>',
  )
  expect(
    coreMarkdown('<main><div hidden data-affordances-md="only">LEAK</div></main>').markdown,
  ).not.toContain('LEAK')
})

// a page through readPage on both paths: md-core must write exactly what the tree pipeline does, without declining
const both = (html: string, options: Options = {}) => {
  forcePath('hast')
  const tree = htmlToMarkdown(html, options).markdown
  forcePath('strict')
  try {
    return [htmlToMarkdown(html, options).markdown, tree]
  } finally {
    forcePath(undefined)
  }
}
const at = {
  url: 'https://example.test/page',
  link: (url: URL) => `${url.origin}${url.pathname}.md`,
}
const text = (md: string, inner = '', block = false) =>
  `<affordances-md data-mode="text"${block ? ' data-block' : ''} data-md="${md}">${inner}</affordances-md>`

test.each([
  ['inline, in a paragraph', `<p>By ${text('**Ann**')}.</p>`],
  [
    'inline, in a link, beside another',
    `<div><a href="/c">${text('Ann', '<span>x</span>')}</a><a href="/d">${text('Bob')}</a></div>`,
  ],
  [
    'with links, relinked',
    `<p>By <a href="/~ann">${text('Ann')}</a>, ${text('[Bob](/~bob)')} ${text('<https://example.test/a_b>')}</p>`,
  ],
  ['a block, lifted out of a paragraph', `<p>Before ${text('- one\n- two', '', true)} after</p>`],
  [
    'a block, lifted out of a heading and a link',
    `<h1>Package <a href="/x">${text('**x**', '', true)}</a> tail</h1>`,
  ],
  [
    'in a table cell',
    `<table><tr><th>A</th></tr><tr><td>${text('a | b\nc', '', true)}</td></tr></table>`,
  ],
  [
    'hidden, still said',
    `<p>a <affordances-md data-mode="text" hidden data-md="said"></affordances-md></p>`,
  ],
  [
    'names nothing with what is inside it',
    `${text('shown', '<span id="h">LEAK</span>')}<p><a href="/x" aria-labelledby="h"><svg></svg></a></p>`,
  ],
  ['an empty one', `<p>a ${text('')} b</p>`],
  ['in a heading read as its button', `<h2><button>Open</button>${text('**said**')}</h2>`],
  ['the page cannot forge one', '<p><span data-affordances-md-text="FORGED">kept</span></p>'],
])('<AgentText>: %s', (_, html) => {
  const [core, tree] = both(html, at)
  expect(core).toBe(tree)
})

test.each([
  ['one main', '<p>out</p><affordances-md data-mode="main"><p>in</p></affordances-md>'],
  [
    'two, and one inside another',
    '<affordances-md data-mode="main"><p>a</p><affordances-md data-mode="main"><p>b</p></affordances-md></affordances-md><nav>n</nav><affordances-md data-mode="main"><p>c</p></affordances-md>',
  ],
  [
    'hidden ones never count',
    '<main><p>m</p></main><div hidden><affordances-md data-mode="main"><p>LEAK</p></affordances-md></div>',
  ],
  [
    'before a <main>',
    '<main><p>m</p></main><affordances-md data-mode="main"><p>marked</p></affordances-md>',
  ],
  [
    'skip and only',
    '<main><affordances-md data-mode="skip"><p>LEAK</p></affordances-md><affordances-md data-mode="only" hidden><p>agents</p></affordances-md></main>',
  ],
  ['with extract none', '<p>out</p><affordances-md data-mode="main"><p>in</p></affordances-md>'],
])('<AgentMain>, <AgentSkip>, <AgentOnly>: %s', (name, html) => {
  const [core, tree] = both(html, name === 'with extract none' ? { extract: 'none' } : {})
  expect(core).toBe(tree)
})

const tabs = (mark: string) =>
  '<div role="tablist"><button role="tab" id="t1">npm</button><button role="tab" id="t2">pnpm</button></div>' +
  `<div role="tabpanel" aria-labelledby="t1" hidden ${mark}><p>one</p></div>` +
  `<div role="tabpanel" aria-labelledby="t2" hidden ${mark}><p>two</p></div><p>after</p>`
test.each([
  ['shown panels', tabs('data-affordances-md="show"')],
  ['not shown', tabs('')],
  [
    'a marker shows, without a heading from the attribute',
    tabs('')
      .replaceAll('<div role="tabpanel"', '<affordances-md data-mode="show" role="tabpanel"')
      .replaceAll('</p></div>', '</p></affordances-md>'),
  ],
  [
    'a panel labelled by something hidden',
    '<span id="h" hidden>LEAK</span><div hidden data-affordances-md="show" role="tabpanel" aria-labelledby="h"><p>Kept</p></div>',
  ],
  [
    'hidden inside a shown panel',
    '<div hidden data-affordances-md="show"><p>Kept</p><p hidden>LEAK</p></div>',
  ],
])('shown tab panels: %s', (_, html) => {
  const [core, tree] = both(html)
  expect(core).toBe(tree)
})

// a link keeps an <AgentMain> with something to read and drops one without; a shown panel under something hidden or
// changed labels its tabs only if prune finds it, which matters only where its tabs alone would decide a tablist
test.each([
  [
    'an <AgentMain> in a link',
    '<a href="/x"><affordances-md data-mode="main"><p>in</p></affordances-md></a>',
  ],
  [
    'an <AgentMain> in a link, after text',
    '<p>before</p><a href="/x"><span><affordances-md data-mode="main"><p>in</p></affordances-md></span></a>',
  ],
  [
    'an <AgentMain> with nothing to read in a link',
    '<p>page</p><a href="/x"><affordances-md data-mode="main"><span hidden>x</span></affordances-md></a>',
  ],
  [
    'an <AgentMain> with only an image in a link',
    '<p>page</p><a href="/x"><affordances-md data-mode="main"><img alt="Logo"></affordances-md></a>',
  ],
  [
    'a shown panel in a cell',
    '<table><tr><td><div data-affordances-md="show"></div></td></tr></table>',
  ],
  [
    'a shown panel under a hidden parent, whose tabs a shown panel also labels',
    '<div hidden><div data-affordances-md="show" aria-labelledby="t1"></div></div><div data-affordances-md="show" aria-labelledby="t1"><p>x</p></div><div role="tablist"><span role="tab" id="t1">t</span></div>',
  ],
  [
    'a shown panel under a hidden parent, labelling no tablist',
    '<div hidden><div data-affordances-md="show" aria-labelledby="t9"></div></div><div role="tablist"><span role="tab" id="t1">t</span></div><p>after</p>',
  ],
])('exact, on md-core: %s', (_, html) => {
  const [core, tree] = both(html)
  expect(core).toBe(tree)
})

test('a marker where the tree pipeline prunes in place first is declined, never written differently', () => {
  for (const html of [
    // a link around an <AgentMain> that holds a tablist, which prune may take out first
    '<a href="/x"><affordances-md data-mode="main"><div role="tablist"><span role="tab" id="t1">t</span></div></affordances-md></a>',
    // a tablist that only a panel under something hidden would take out
    '<div hidden><div data-affordances-md="show" aria-labelledby="t1"></div></div><div role="tablist"><span role="tab" id="t1">t</span></div>',
  ]) {
    declines.clear()
    forcePath('core')
    const core = htmlToMarkdown(html).markdown
    forcePath('hast')
    expect(core).toBe(htmlToMarkdown(html).markdown)
    expect(declines.size).toBe(1)
    forcePath(undefined)
  }
})

// a link around an <AgentMain> takes out what carries a value and blocks with nothing to read before the main is
// read, and is gone, main and all, when it says nothing but values: md-core declines both
test.each([
  [
    'a value in it',
    '<p>page</p><a href="/x"><affordances-md data-mode="main"><p>in</p><output>3</output></affordances-md></a>',
  ],
  [
    'an empty block in it',
    '<p>page</p><a href="/x"><affordances-md data-mode="main"><p>in</p><div></div></affordances-md></a>',
  ],
  [
    'a link that says only a value',
    '<p>page</p><a href="/x"><affordances-md data-mode="main"><output>3</output></affordances-md></a>',
  ],
  [
    'a labelled link that says only a value',
    '<p>page</p><a href="/x" aria-label="L"><affordances-md data-mode="main"><output>3</output></affordances-md></a>',
  ],
])('an <AgentMain> in a link md-core declines: %s', (_, html) => {
  forcePath('hast')
  const tree = htmlToMarkdown(html).markdown
  forcePath('core')
  declines.clear()
  expect({ core: htmlToMarkdown(html).markdown, declined: [...declines.keys()] }).toEqual({
    core: tree,
    declined: ['main marker inside what prune changes'],
  })
  forcePath(undefined)
})

// a shown panel is headed by its tab as @affordances/md finds it: by the page's ids, gathered the first time they're
// needed, from the page as pruned so far. md-core works out when that is and what's gone by then, and heads each panel
// the same, wherever its tab is: beside it, in a wrapper, in the panel itself, or in a heading
const shown = (id: string, body: string) =>
  `<div role="tabpanel" data-affordances-md="show" aria-labelledby="${id}" hidden>${body}</div>`
const tablist = '<div role="tablist"><button role="tab" id="t1">npm</button></div>'
test.each([
  ['a tablist beside its panels', `${tablist}${shown('t1', '<p>one</p>')}`, []],
  ['a tablist in a wrapper before', `<div>${tablist}</div>${shown('t1', '<p>one</p>')}`, []],
  ['a tablist in a wrapper after', `${shown('t1', '<p>one</p>')}<div>${tablist}</div>`, []],
  ['the panels in a wrapper', `${tablist}<div>${shown('t1', '<p>one</p>')}</div>`, []],
  [
    'a tablist in a scroll wrapper, after an icon link',
    `<a href="/i" aria-label="Home"><svg></svg></a><div><div class="overflow-x-auto">${tablist}</div>${shown('t1', '<p>one</p>')}</div>`,
    [],
  ],
  [
    'the panels in a wrapper, one shown',
    `<div>${tablist}<div>${shown('t1', '<p>one</p>')}<div role="tabpanel" aria-labelledby="t1" hidden><p>two</p></div></div></div>`,
    [],
  ],
  [
    'a tab in a link',
    `<div><a href="/x"><span role="tab" id="t2">Tab</span></a></div>${shown('t2', '<p>x</p>')}`,
    ['x'],
  ],
  [
    'the tab in its own heading',
    '<div role="tabpanel" data-affordances-md="show" aria-labelledby="t3"><h2><button role="tab" id="t3">Tab t2</button></h2></div>',
    [],
  ],
  [
    'the tab in its own summary',
    '<div role="tabpanel" data-affordances-md="show" aria-labelledby="t2"><summary><button role="tab" id="t2">Tab t1</button></summary></div>',
    [],
  ],
  [
    'the tab in its own panel',
    '<div role="tabpanel" data-affordances-md="show" aria-labelledby="t2"><button role="tab" id="t2">Tab</button><p>x</p></div>',
    [],
  ],
  [
    'the tab in a heading in a wrapper before',
    `<div><h2><button role="tab" id="t2">Tab</button></h2></div>${shown('t2', '<p>x</p>')}`,
    [],
  ],
])('shown panels md-core heads as the tree pipeline does, or declines: %s', (_, html, why) => {
  forcePath('hast')
  const tree = htmlToMarkdown(html).markdown
  forcePath('core')
  declines.clear()
  expect({ core: htmlToMarkdown(html).markdown, declined: [...declines.keys()] }).toEqual({
    core: tree,
    declined: why.length ? ["shown panel headed by a tab md-core can't place"] : [],
  })
  forcePath(undefined)
})

// markers nested in links and links in markers, at random: md-core reads each as the tree pipeline does, through
// htmlToMarkdown and readPage, its slots and its markdown with and without fills
const read = (html: string, options: Options) => {
  const page = readPage(html, options)
  const { markdown, ...rest } = page
  return JSON.stringify([
    htmlToMarkdown(html, options),
    rest,
    markdown(),
    markdown({ a: 'F-A', b: 'F-B' }),
  ])
}
test('every generated page of markers in links reads as the tree pipeline does', () => {
  const differ: string[] = []
  for (const seed of [1, 2]) {
    const next = markerPages(seed)
    for (let i = 0; i < 1000; i++) {
      const { html, options } = next()
      forcePath('hast')
      const tree = read(html, options)
      forcePath('core')
      if (read(html, options) !== tree) differ.push(html)
    }
  }
  forcePath(undefined)
  expect(differ).toEqual([])
}, 30_000)
