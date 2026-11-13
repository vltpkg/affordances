import { afterEach, expect, test } from 'vitest'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { readPage } from '../../../src/index.ts'

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
const both = (html: string, fills: (Record<string, string> | undefined)[] = [undefined]) => {
  forcePath('hast')
  const tree = read(html, fills)
  forcePath('strict')
  return { core: read(html, fills), tree }
}

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
    'in a heading, a link and emphasis',
    `<h1>Package ${slot('v')}</h1><p><a href="/p">See ${slot('w')} more</a></p><p><em>A ${slot('x')}</em> b</p>`,
    { v: 'express', w: '[docs](/docs)', x: '- one' },
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

test('a slot md-core cannot tell prune keeps is declined, never written differently', () => {
  for (const html of [
    // a link drops a block with nothing to read
    `<p><a href="/x">${slot('a', '')}</a></p>`,
    // a skeleton table goes whole
    `<table><tr><th>A</th></tr><tr><td>${slot('a', '')}</td></tr></table>`,
  ]) {
    forcePath('hast')
    const tree = readPage(html).markdown({ a: 'FILL' }).markdown
    forcePath('core')
    declines.clear()
    expect(readPage(html).markdown({ a: 'FILL' }).markdown).toBe(tree)
    expect(declines.size).toBe(1)
  }
})
