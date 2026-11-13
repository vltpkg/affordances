import { expect, test } from 'vitest'
import { declines, forcePath } from '../../../src/convert/path.ts'
import type { Options } from '../../../src/index.ts'
import { htmlToMarkdown as coreMarkdown } from '../../../src/convert/core/index.ts'
import { htmlToMarkdown } from '../../../src/index.ts'

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

test('a marker where the tree pipeline prunes in place first is declined, never written differently', () => {
  for (const html of [
    '<a href="/x"><affordances-md data-mode="main"><p>in</p></affordances-md></a>',
    '<div hidden><div data-affordances-md="show" aria-labelledby="t1"></div></div><div role="tablist"><span role="tab" id="t1">t</span></div>',
    '<table><tr><td><div data-affordances-md="show"></div></td></tr></table>',
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
