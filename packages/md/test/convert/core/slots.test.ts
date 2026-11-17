import { afterEach, expect, test } from 'vitest'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { readPage } from '../../../src/index.ts'
import { onBoth } from './support/paths.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

const slot = (name: string, inner = '…') =>
  `<affordances-md data-mode="slot" data-name="${name}">${inner}</affordances-md>`
const at = {
  url: 'https://example.test/page',
  link: (url: URL) => `${url.origin}${url.pathname}.md`,
}

// a page read on both paths, md-core's in strict mode: its slots, then its markdown with each set of fills in turn,
// all from the one read
const read = (html: string, fills: (Record<string, string> | undefined)[]) => {
  const page = readPage(html, at)
  return { slots: page.slots, markdown: fills.map((fill) => page.markdown(fill).markdown) }
}
const both = (html: string, fills: (Record<string, string> | undefined)[] = [undefined]) =>
  onBoth(() => read(html, fills), 'strict')

test.each([
  [
    'in page order, unique and duplicate',
    `${slot('b')}<p>x</p>${slot('a')}${slot('b')}${slot('c')}`,
  ],
  ['one inside another never counts', slot('outer', `<p>${slot('inner')}</p>`)],
  [
    'hidden, skipped or in an AgentText, never',
    `<div hidden>${slot('h')}</div><affordances-md data-mode="skip">${slot('s')}</affordances-md><affordances-md data-mode="text" data-md="t">${slot('t')}</affordances-md>${slot('kept')}`,
  ],
  ['outside the main, never', `${slot('out')}<main>${slot('in')}</main>`],
  [
    'outside an AgentMain, never',
    `<main>${slot('m')}</main><affordances-md data-mode="main">${slot('am')}</affordances-md>`,
  ],
  [
    'in chrome a page without a main strips, never',
    `<nav>${slot('nav')}</nav><p>${slot('body')}</p>`,
  ],
  ['without a name, never', `${slot('')}<p>x</p>`],
])('slot names: %s', (_, html) => {
  const { core, tree } = both(html)
  expect(core).toEqual(tree)
})

test.each([
  ['a block, in a paragraph', `<p>Latest ${slot('v')} today</p>`, { v: '**5.1.0**' }],
  [
    'in a heading and emphasis',
    `<h1>Package ${slot('v')}</h1><p><em>A ${slot('x')}</em> b</p>`,
    { v: 'express', x: '- one' },
  ],
  [
    'in table cells',
    `<table><tr><th>Name</th><th>Notes</th></tr><tr><td>${slot('a')}</td><td><p>${slot('b')}</p></td></tr></table>`,
    { a: 'line1\n\nline2 a|b', b: '- x\n- y' },
  ],
  [
    'in code, which never shows it',
    `<p><code>x ${slot('a', 'fallback')} y</code></p><pre><code>x ${slot('a', 'fallback')} y</code></pre>`,
    { a: 'FILL' },
  ],
  [
    'a duplicate fills nothing',
    `${slot('d', '<p>one</p>')}${slot('d', '<p>two</p>')}`,
    { d: 'FILL' },
  ],
  [
    'an empty fill leaves nothing',
    `<p>Before</p>${slot('e', '<p>Loading…</p>')}<p>After</p>`,
    { e: '' },
  ],
  [
    'in a heading read as its button, and in one whose slot holds a value',
    `<h2><button>Open</button>${slot('x', '')}</h2><h3>${slot('y', '<input value="v">')}</h3><p>body</p>`,
    { x: 'FILLED', y: 'TOO' },
  ],
  [
    'its children still name and judge what is around it',
    `<p><a href="/x">${slot('a', '<span id="n">name</span>')}</a></p><p><a href="/y" aria-labelledby="n"><svg></svg></a></p>`,
    { a: 'FILL' },
  ],
])('fills: %s', (_, html, fill) => {
  const { core, tree } = both(html, [fill])
  expect(core).toEqual(tree)
})

test('a second markdown() with other fills is what the tree pipeline writes, as is a first without any', () => {
  const { core, tree } = both(
    `<h1>Pkg</h1>${slot('readme', '<p>Loading readme…</p>')}<p>${slot('v')}</p>`,
    [{ readme: '## Readme\n\nFast.', v: '1.0.0' }, { readme: 'Other [link](/l)' }, undefined],
  )
  expect(core).toEqual(tree)
})

// a link drops a block with nothing to read, and keeps one with something: either way md-core reads it as the tree
// pipeline does
test.each([
  ['nothing to read', `<p><a href="/x">${slot('a', '')}</a></p>`],
  ['only something hidden', `<p><a href="/x">${slot('a', '<span hidden>h</span>')}</a></p>`],
  ['something to read', `<p><a href="/x">${slot('a', '<span>Loading</span>')}</a></p>`],
  ['a described image', `<p><a href="/x">${slot('a', '<img alt="icon">')}</a></p>`],
])('a slot in a link with %s', (_, html) => {
  const { core, tree } = both(html, [{ a: 'FILL' }, undefined])
  expect(core).toEqual(tree)
})

test('a slot md-core cannot tell prune keeps is declined, never written differently', () => {
  for (const html of [
    // a link around a tablist prune may take out first
    `<a href="/x">${slot('a', '<div role="tablist"><span role="tab" id="t">t</span></div>')}</a>`,
    // a skeleton table goes whole
    `<table><tr><th>A</th></tr><tr><td>${slot('a', '')}</td></tr></table>`,
  ]) {
    const { core, tree, declined } = onBoth(() => readPage(html).markdown({ a: 'FILL' }).markdown)
    expect(core).toBe(tree)
    expect(declined).toHaveLength(1)
  }
})

// a link drops a slot with nothing to read, wherever the content starts, and a link that says nothing but values is
// its label, or gone with the slot: md-core never counts a slot the tree pipeline drops, and declines where it can't
// tell
test.each([
  [
    'an empty slot in an <AgentMain> in a link',
    `<a href="/y" aria-label="Y label"><affordances-md data-mode="main">${slot('a', '')}Head</affordances-md></a>`,
    // the link takes the empty slot out of the main first: md-core declines the main
    ['main marker inside what prune changes'],
  ],
  [
    'a slot with only a value, in a link labelled by nothing',
    `<a href="/z" aria-labelledby="lbl">${slot('a', '<output>out</output>')}</a>`,
    ['slot holding a value'],
  ],
  [
    'a slot with only a value, in a labelled link',
    `<p>x</p><a href="/z" aria-label="L">${slot('a', '<output>out</output>')}</a>`,
    ['slot holding a value'],
  ],
  [
    'a slot in a label in an <AgentMain> in a link',
    `<a href="/w" title="W"><affordances-md data-mode="main"><label>${slot('a', 'fallback')}</label></affordances-md></a>`,
    [],
  ],
  // a slot among other things in a link, or in something inside one
  ['a slot in a link with text', `<p><a href="/p">See ${slot('a')} more</a></p>`, []],
  ['a slot in a span in a link', `<p><a href="/x"><span>${slot('a', '')}</span></a></p>`, []],
  [
    'a slot in an image link in a summary, with only a value',
    `<a href="/y" aria-label="Y label"><summary><button><img src="/i.png" alt="Pic">${slot('a', '<output>out</output>')}`,
    ['slot holding a value'],
  ],
  [
    'a slot in an optgroup in a link',
    `<a href="/y">&#x0;<optgroup>${slot('a', '&#x0;')}`,
    ["slot inside an element md-core can't judge"],
  ],
])('a slot in a link around its content: %s', (_, html, why) => {
  const { core, tree, declined } = onBoth(() => {
    const page = readPage(html, at)
    return [page.slots, page.markdown({ a: 'FILL' }).markdown]
  })
  expect({ read: core, declined }).toEqual({
    read: tree,
    declined: why,
  })
})

// the placements real pages put a slot in, each read on md-core exactly as the tree pipeline reads it
test.each([
  ['a div', `<div>${slot('s', 'fallback')}</div>`],
  ['a section', `<section>${slot('s', 'fallback')}</section>`],
  ['a paragraph', `<p>${slot('s', 'fallback')}</p>`],
  ['a list item', `<ul><li>${slot('s', 'fallback')}</li></ul>`],
  ['a table cell', `<table><tr><td>a</td><td>${slot('s', 'fallback')}</td></tr></table>`],
  ['a heading', `<h2>Title ${slot('s', 'fallback')}</h2>`],
  ['a span', `<p><span>${slot('s', 'fallback')}</span></p>`],
  ['strong', `<p><strong>${slot('s', 'fallback')}</strong></p>`],
  ['a link with text', `<a href="/x">go ${slot('s', 'fallback')}</a>`],
  ['a button', `<button>${slot('s', 'fallback')}</button>`],
  ['a label', `<label>${slot('s', 'fallback')}</label>`],
  ['a summary', `<details><summary>${slot('s', 'fallback')}</summary></details>`],
  ['a blockquote', `<blockquote>${slot('s', 'fallback')}</blockquote>`],
])('a slot in %s reads on md-core as the tree pipeline reads it', (_, html) => {
  const { core, tree } = both(html, [{ s: 'FILLED' }, undefined])
  expect(core).toEqual(tree)
})

// a slot under what carries a value (its text is a value, and prune may take it out), wherever it is: md-core declines
test.each([
  ['an optgroup in a heading', `<h2><optgroup>${slot('a')}`],
  ['a meter in a heading', `<h1><meter>${slot('a')}`],
  ['an option in a term', `<dt><option>${slot('a')}`],
  ['a meter in a summary', `<summary><meter>${slot('a')}`],
  ['a progress in a link', `<a href="/x"><progress>${slot('a')}1. n`],
  ['a textarea in a header cell', `<math><th><textarea>${slot('a')}`],
  ['a datalist in a button in a heading', `<h2><button><datalist><${slot('a')}`],
])('a slot under a value md-core declines: %s', (_, html) => {
  const { core, tree, declined } = onBoth(() => {
    const page = readPage(html, at)
    return [page.slots, page.markdown({ a: 'FILL' }).markdown]
  })
  expect({ read: core, declined }).toEqual({
    read: tree,
    declined: ["slot inside an element md-core can't judge"],
  })
})

// what's inside an <AgentMain> is read for shown panels and tablists as the rest of the page is: a slot in a tablist
// a shown panel's tab takes out is never counted
test('a slot in a shown tablist inside an <AgentMain> is declined, never counted', () => {
  const html = `<affordances-md data-mode="main"><div role="tablist"><button role="tab" id="t3">x</button>${slot('b', 'y')}</div><section data-affordances-md="show" aria-labelledby="t3">p</section></affordances-md>`
  const { core, tree, declined } = onBoth(() => {
    const page = readPage(html, at)
    return [page.slots, page.markdown({ b: 'FILL' }).markdown]
  })
  expect({ read: core, declined }).toEqual({
    read: tree,
    declined: ['slot inside a tablist'],
  })
})
