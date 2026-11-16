import { afterEach, expect, test } from 'vitest'
import { CUT, DEPTH } from '../../../src/convert/depth.ts'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { flightStripper, readStreamed } from '../../../src/convert/index.ts'
import { htmlToMarkdown, readPage } from '../../../src/index.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

// a page nested deeper than md reads (DEPTH elements, the document's children at 1) is read as text past it, and one
// nesting past CUT open elements is read up to the tag that opens one more, on both paths: no public call ever throws
// on one, however deep, and none takes longer the deeper it goes
const nest = (tag: string, n: number, inner = 'deep words') =>
  `<main><p>top</p>${`<${tag}>`.repeat(n)}${inner}${`</${tag}>`.repeat(n)}<p>after</p></main>`
const read = (html: string) => {
  const page = readPage(html)
  return [
    htmlToMarkdown(html).markdown,
    page.markdown().markdown,
    page.markdown({ a: 'F' }).markdown,
  ]
}

test.each([
  ['div', 2_000],
  ['div', 20_000],
  ['div', 100_000],
  ['svg', 2_000],
  ['svg', 20_000],
  ['svg', 100_000],
  ['span', 100_000],
])('%s nested %i deep is read up to where it nests past CUT, on both paths, quickly', (tag, n) => {
  const html = nest(tag, n)
  for (const path of ['core', 'hast'] as const) {
    forcePath(path)
    const started = performance.now()
    const [markdown, ...rest] = read(html)
    // generous, and far under what reading the whole nesting would take (seconds to minutes on the tree pipeline)
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(rest).toEqual([markdown, markdown])
    expect(markdown).toBe('top\n')
    expect(readPage(html).cut).toBe(true)
  }
})

test('a page nesting CUT open elements and no more is read whole', () => {
  // html, body and main are 3 of the open elements
  const html = nest('div', CUT - 3)
  for (const path of ['core', 'hast'] as const) {
    forcePath(path)
    expect([read(html)[0], readPage(html).cut]).toEqual(['top\n\ndeep words\n\nafter\n', undefined])
  }
  // and one more is cut, the same on both paths
  const deeper = nest('div', CUT - 2)
  forcePath('hast')
  const tree = [...read(deeper), readPage(deeper).cut]
  forcePath('core')
  expect([...read(deeper), readPage(deeper).cut]).toEqual(tree)
  expect(tree.at(-1)).toBe(true)
})

test(
  'unclosed formatting 100,000 deep is read up to the cut, the same on both paths, quickly',
  { timeout: 30_000 },
  () => {
    const html = `<main><p>top</p>${'<b>'.repeat(100_000)}deep words</main>`
    forcePath('hast')
    let started = performance.now()
    const tree = read(html)
    // the tree pipeline converts the bold nested as deep as md reads, whatever the page's own depth
    expect(performance.now() - started).toBeLessThan(5_000)
    forcePath('core')
    started = performance.now()
    expect(read(html)).toEqual(tree)
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(tree[0]!.startsWith('top\n')).toBe(true)
    expect(tree[0]).not.toContain('deep words')
  },
)

// past DEPTH and under CUT, a page is read as text past DEPTH, the same on both paths
test.each([
  ['div', 300],
  ['div', 500],
  ['span', 500],
  ['svg', 500],
  ['b', 500],
])('%s nested %i deep reads the same on both paths', (tag, n) => {
  const html = tag === 'b' ? `<main>${'<b>'.repeat(n)}deep words</main>` : nest(tag, n)
  forcePath('hast')
  const tree = read(html)
  forcePath('core')
  expect(read(html)).toEqual(tree)
})

test('past the depth, only structure gives up its text: nothing hidden, no control, no marker', () => {
  const inner =
    'shown <span hidden>LEAK1</span><span class="sr-only">LEAK2</span><input value="LEAK3"><template>LEAK4</template>' +
    '<affordances-md data-mode="skip">LEAK5</affordances-md><em>kept</em>'
  const html = nest('div', DEPTH + 50, inner)
  for (const path of ['hast', 'core'] as const) {
    forcePath(path)
    const [markdown] = read(html)
    expect(markdown).toBe('top\n\nshown kept\n\nafter\n')
    // and the page says something of it is missing
    expect(readPage(html).cut).toBe(true)
  }
})

test('a page as deep as md reads, and no deeper, reads as it always has', () => {
  // DEPTH counts from the document: html, body and main are 1 to 3, then the sections, the p, and its em at DEPTH
  const html = nest('section', DEPTH - 5, '<h2>Title</h2><p>Body <em>text</em></p>')
  forcePath('hast')
  const tree = read(html)
  forcePath('core')
  expect(read(html)).toEqual(tree)
  expect(tree[0]).toBe('top\n\n## Title\n\nBody _text_\n\nafter\n')
})

// what the flatten leaves out, the page says it left out, as it says a cut: only plain structure loses nothing
test.each([
  ['a classed element past DEPTH', nest('div', DEPTH + 10, '<span class="x">said</span>'), true],
  ['a table past DEPTH', nest('div', DEPTH + 10, '<table><tr><td>cell</td></tr></table>'), true],
  [
    'only plain structure past DEPTH',
    nest('div', DEPTH + 10, '<p>a <b>bold</b> <em>word</em></p>'),
    undefined,
  ],
  ['nothing past DEPTH', nest('div', 20, '<span class="x">said</span>'), undefined],
  // what md never reads (a template, an object, an svg's foreignObject) leaves nothing out, past DEPTH or holding it
  [
    'a template past DEPTH',
    nest('div', DEPTH + 10, '<template><b class="x">t</b></template>w'),
    undefined,
  ],
  [
    'an object past DEPTH',
    nest('div', DEPTH + 10, '<object><span class="x">o</span></object>w'),
    undefined,
  ],
  [
    'a template holding what nests past DEPTH',
    `<main><template>${nest('div', DEPTH + 10, '<span class="x">said</span>')}</template>w</main>`,
    undefined,
  ],
  [
    'an svg foreignObject holding html past DEPTH',
    nest(
      'div',
      DEPTH - 10,
      `<svg><foreignObject>${'<div>'.repeat(20)}<span class="x">f</span></foreignObject></svg>`,
    ),
    undefined,
  ],
  [
    'a classed element beside a template past DEPTH',
    nest('div', DEPTH + 10, '<template>t</template><i class="x">i</i>'),
    true,
  ],
])('%s: cut is %s on both paths', (_, html, cut) => {
  for (const path of ['core', 'hast'] as const) {
    forcePath(path)
    expect([path, readPage(html).cut]).toEqual([path, cut])
  }
})

// how deep a page nests is what html's parser makes of it, not its tags: an end tag it ignores (</span> with no span
// open, </p> with no p) closes nothing, and </br> is a <br>. both paths cut such a page in the same place
test.each([
  ['</span> closing nothing', `<main>${'<div></span>'.repeat(2_000)}deep words</main>`],
  ['</p> closing nothing', `<main>${'<div></p>'.repeat(2_000)}deep words</main>`],
  ['</br>, which is a <br>', `<main>${'<div></br>'.repeat(2_000)}deep words</main>`],
])('a page nesting past CUT through %s is cut the same on both paths', (_, html) => {
  forcePath('hast')
  const tree = [...read(html), readPage(html).cut]
  forcePath('core')
  expect([...read(html), readPage(html).cut]).toEqual(tree)
  expect(tree.at(-1)).toBe(true)
  expect(tree[0]).not.toContain('deep words')
})

// what's in svg or math md reads nothing of, so what the flatten does there leaves nothing out
test.each([
  [
    'svg nested past DEPTH',
    `<main><p>top</p>${'<svg>'.repeat(DEPTH + 50)}x${'</svg>'.repeat(DEPTH + 50)}</main>`,
  ],
  [
    'svg and math past DEPTH',
    nest('div', DEPTH + 10, '<svg><g><text>t</text></g></svg><math><mi>x</mi></math>'),
  ],
])('%s: cut is unset on both paths', (_, html) => {
  for (const path of ['core', 'hast'] as const) {
    forcePath(path)
    expect([path, readPage(html).cut]).toEqual([path, undefined])
  }
})

// the tree pipeline asks md-core's parser where to cut only once parse5 nests past CUT itself: on pages that nest
// through what html's parser closes, reopens, fosters and ignores, both paths agree on whether and where a page is cut
test('generated deep pages are cut, or not, the same on both paths', { timeout: 30_000 }, () => {
  let state = 7
  const rnd = (n: number) => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state % n
  }
  // no strikethrough or nobr: what they write in a list, or split, is another test's
  const pieces = (
    '<div>|<span>|<b>|<i>|<font>|<a href="/x">|<svg>|<math>|<mtext>|<foreignObject>|<table>|<td>|<tr>|<select>|' +
    '<option>|<li>|<dd>|<p>|<button>|<template>|<object>|</span>|</p>|</br>|</b>|</div>|</table>|</a>|text|<br>'
  ).split('|')
  let cut = 0
  for (let i = 0; i < 60; i++) {
    let html = '<main>'
    for (let n = 1000 + rnd(5000); n > 0; n--) html += pieces[rnd(pieces.length)]
    forcePath('hast')
    const tree = [...read(html), readPage(html).cut]
    forcePath('core')
    expect([...read(html), readPage(html).cut]).toEqual(tree)
    if (tree.at(-1)) cut++
  }
  // some are cut and some aren't
  expect(cut).toBeGreaterThan(10)
  expect(cut).toBeLessThan(50)
})

// a page's flight data and streamed boundaries are read on all of it, before what's nested past DEPTH is read as text:
// a push or a boundary nested deeper reads as it does shallow. past CUT, the flight data is checked against the pushes
// before the cut, and the page says it's cut
const push = (row: string) => `<script>self.__next_f.push(${JSON.stringify([1, row])})</script>`
const streamedRead = (html: string, options = {}) => {
  const strip = flightStripper()
  const lean = strip.write(html) + strip.end()
  const page = readStreamed(lean, strip.swapped(), options)
  return [page.markdown().markdown, page.errors, page.cut]
}
const swapShallow = '<div hidden id="S:0"><p>moved</p></div><script>$RC("B:0","S:0")</script>'
const boundary = '<!--$?--><template id="B:0"></template><p>Loading...</p><!--/$-->'
test.each([
  ['a push after a cut', nest('div', 600) + push('0:x\n'), ['top\n', [], true]],
  [
    'a digest push after a cut',
    nest('div', 600) + push('5:E{"digest":"DIG"}\n'),
    ['top\n', ['DIG'], true],
  ],
  [
    'a push nested past DEPTH',
    nest('div', DEPTH + 12, `deep words${push('0:x\n')}`),
    ['top\n\ndeep words\n\nafter\n', [], undefined],
  ],
  [
    'a boundary nested past DEPTH, its segment shallow',
    nest('div', DEPTH + 12, boundary) + swapShallow,
    ['top\n\nmoved\n\nafter\n', [], undefined],
  ],
  [
    'a boundary and its segment nested past DEPTH',
    nest('div', DEPTH + 12, boundary + swapShallow),
    ['top\n\nmoved\n\nafter\n', [], true],
  ],
  [
    'a json-ld script past DEPTH',
    nest('div', DEPTH + 12, 'words<script type="application/ld+json">{"a":1}</script>'),
    ['top\n\nwords\n\nafter\n\n```json\n{\n  "a": 1\n}\n```\n', [], undefined],
  ],
])('%s reads as it does shallow, the same on both paths', (_, html, expected) => {
  for (const path of ['core', 'hast'] as const) {
    forcePath(path)
    const page = readPage(html, { jsonLd: true })
    expect([path, page.markdown().markdown, page.errors, page.cut]).toEqual([path, ...expected])
    expect([path, ...streamedRead(html, { jsonLd: true })]).toEqual([path, ...expected])
  }
})

// past DEPTH, a block's text is a line of its own and a <br> ends one, as each lays out: never run into the next,
// or into the text before the nest
test.each([
  ['blocks', nest('div', DEPTH + 10, '<div>alpha</div><div>beta</div>'), 'alpha beta'],
  [
    'paragraphs',
    nest('div', DEPTH + 10, '<p>Two words</p><p>Next para</p>'),
    'Two words Next para',
  ],
  ['a break', nest('div', DEPTH + 10, 'alpha<br>beta'), 'alpha beta'],
  ['inline elements', nest('div', DEPTH + 10, 'a<b>b</b><i>c</i> <em>d</em>'), 'abc d'],
  [
    'a block after text outside the nest',
    `<main>shown${'<span>'.repeat(DEPTH + 10)}<p>moved</p>${'</span>'.repeat(DEPTH + 10)}</main>`,
    'shown moved',
  ],
])('%s past DEPTH keep their text apart, the same on both paths', (_, html, text) => {
  forcePath('hast')
  const tree = read(html)
  forcePath('core')
  expect(read(html)).toEqual(tree)
  expect(tree[0]).toBe(html.startsWith('<main><p>top') ? `top\n\n${text}\n\nafter\n` : `${text}\n`)
})

// htmlToMarkdown says a page was cut, as readPage does, on both paths
test.each([
  ['nested past CUT', nest('div', 2_000), true],
  [
    'nested past DEPTH, an image left out',
    nest('div', DEPTH + 10, '<img src="/a.png" alt="pic">'),
    true,
  ],
  ['nested past DEPTH, only text', nest('div', DEPTH + 10), undefined],
  ['nested within DEPTH', nest('div', 40), undefined],
])('htmlToMarkdown on a page %s says cut', (_, html, cut) => {
  for (const path of ['core', 'hast'] as const) {
    forcePath(path)
    expect([path, htmlToMarkdown(html).cut, readPage(html).cut]).toEqual([path, cut, cut])
  }
})
