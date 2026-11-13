import type { Root } from 'hast'
import { fromParse5 } from 'hast-util-from-parse5'
import { parse as parseHtml } from 'parse5'
import { afterEach, expect, test } from 'vitest'
import { resolveStreamed } from '../../../src/convert/index.ts'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { readPage } from '../../../src/index.ts'
import { onMoved, parse as parseCore } from '../../../src/convert/core/parse.ts'
import type { Element } from '../../../src/convert/core/types.ts'
import { corpusPages, fixturePages } from './emit-pages.ts'
import { generate } from './parse-fuzz.ts'
import { treePages } from './tree-fuzz.ts'
import { nestedStreamedPages } from './streamed-fuzz.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

// md-core moves react's streamed boundaries into place as the tree pipeline does (resolveStreamed), so a page whose
// boundaries move reads the same on both paths: its rows, its markdown with and without a fill. it declines only
// what it can't see (inside svg it keeps nothing), and the tests below hold it to the reasons it gives
const moves = (html: string) => {
  const tree = fromParse5(parseHtml(html, { scriptingEnabled: false })) as Root
  const before = JSON.stringify(tree)
  resolveStreamed(tree).resolve()
  return JSON.stringify(tree) !== before
}
const read = (html: string) => {
  const page = readPage(html, { url: 'https://site.test/a' })
  const { markdown, ...rest } = page
  return JSON.stringify([rest, markdown().markdown, markdown({ a: 'F' }).markdown])
}
const both = (html: string) => {
  forcePath('hast')
  const tree = read(html)
  forcePath('core')
  declines.clear()
  const core = read(html)
  return { core, tree, declined: [...declines.keys()] }
}

test.each([
  [
    'a boundary',
    '<div><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--></div><div hidden id="S:0"><p>Done</p></div><script>$RC("B:0","S:0")</script>',
  ],
  [
    'a placeholder',
    '<p><template id="P:1"></template></p><div hidden id="S:1">x</div><script>$RS("S:1","P:1")</script>',
  ],
  [
    'a boundary by template',
    '<!--$?--><template id="B:1"></template>fallback<!--/$--><div hidden id="S:2">real</div><template data-rci="" data-bid="B:1" data-sid="S:2"></template>',
  ],
  [
    'a placeholder by template',
    '<template id="P:2"></template><div hidden id="S:3">y</div><template data-rsi="" data-pid="P:2" data-sid="S:3"></template>',
  ],
  [
    'one with its stylesheets',
    '<!--$?--><template id="B:2"></template>f<!--/$--><div hidden id="S:4">z</div><script>$RR("B:2","S:4",[])</script>',
  ],
  [
    'an instruction in svg, spelled with a reference',
    '<!--$?--><template id="B:3"></template>f<!--/$--><div hidden id="S:5">z</div><svg><script>&#36;RC("B:3","S:5")</script></svg>',
  ],
  [
    'a template in capitals',
    '<!--$?--><TEMPLATE ID="B:4"></TEMPLATE>f<!--/$--><div hidden id="S:6">z</div><script>$RC("B:4","S:6")</script>',
  ],
  [
    'an attribute that holds a >',
    '<!--$?--><template title="a>b" id="B:5"></template>f<!--/$--><div hidden id="S:7">z</div><script>$RC("B:5","S:7")</script>',
  ],
  [
    'a boundary in a boundary, moved after it',
    '<main><!--$?--><template id="B:0"></template>outer fallback<!--/$--></main><div hidden id="S:0"><p>outer</p><!--$?--><template id="B:1"></template>inner fallback<!--/$--></div><div hidden id="S:1"><p>inner</p></div><script>$RC("B:0","S:0");$RC("B:1","S:1")</script>',
  ],
  [
    'a fallback with a boundary of its own, and no closing comment',
    '<main><!--$?--><template id="B:0"></template>a<!--$-->b<!--/$-->c</main><div hidden id="S:0"><p>moved</p></div><script>$RC("B:0","S:0")</script>',
  ],
  [
    'the metadata streamed into the body',
    '<head><title>Shell</title></head><body><main><!--$?--><template id="B:0"></template>…<!--/$--></main><div hidden id="S:0"><title>Moved</title><meta name="description" content="d"><h1>Page</h1></div><script>$RC("B:0","S:0")</script></body>',
  ],
  [
    'the last element with an id wins',
    '<main><!--$?--><template id="B:0"></template>f<!--/$--></main><div hidden id="S:0">first</div><div hidden id="S:0">second</div><script>$RC("B:0","S:0")</script>',
  ],
  [
    'a segment in a noscript',
    '<main><!--$?--><template id="B:0"></template>f<!--/$--></main><noscript><div id="S:0"><p>moved out</p></div></noscript><script>$RC("B:0","S:0")</script>',
  ],
  [
    'a comment in a table',
    '<table><!--$?--><template id="B:0"></template><tr><td>f</td></tr><!--/$--></table><div hidden id="S:0"><p>moved</p></div><script>$RC("B:0","S:0")</script>',
  ],
  // what a move takes out of the tree is out of it for what reads the page after: its head, its mains
  [
    'a fallback with no end, which takes the title with it',
    '<template id="B:0"></template><div id="S:0"></div><script>$RC("B:0","S:0")</script><title>gone</title>',
  ],
  [
    'a segment that holds its own template, emptied',
    '<d id="S:0"><template id="B:0"></template><script>$RC("B:0","S:0")</script><meta name="description" content="d"></d>',
  ],
  // the instructions in tree order: foster parenting puts a later script before an earlier one
  [
    'instructions fostered out of a table',
    '<template id="B:0"></template><table><div id="S">x</div><script>$RC("B:0","S")</script><t><script>$RC("B:0","1")</script></t></table>',
  ],
])('md-core moves it as the tree pipeline does: %s', (_, html) => {
  expect(moves(html)).toBe(true)
  const { core, tree, declined } = both(html)
  expect({ core, declined }).toEqual({ core: tree, declined: [] })
})

test("an instruction in a template's content moves nothing, on either path", () => {
  const html =
    '<main><!--$?--><template id="B:0"></template>f<!--/$--></main><div hidden id="S:0">x</div><template><script>$RC("B:0","S:0")</script></template>'
  expect(moves(html)).toBe(false)
  const { core, tree, declined } = both(html)
  expect({ core, declined }).toEqual({ core: tree, declined: [] })
})

test.each([
  [
    'a template in svg',
    '<main><svg><!--$?--><template id="B:0"></template>f<!--/$--></svg></main><div hidden id="S:0">x</div><script>$RC("B:0","S:0")</script>',
    // the pre-check's: the scan sends it before md-core parses it
    'streamed',
  ],
  [
    'a template in svg, in capitals the scan misses',
    '<main><svg><!--$?--><TEMPLATE id="B:0"></TEMPLATE>f<!--/$--></svg></main><div hidden id="S:0">x</div><script>$RC("B:0","S:0")</script>',
    'streamed boundary in svg',
  ],
  [
    'a segment in svg',
    '<main><!--$?--><template id="B:0"></template>f<!--/$--></main><svg><g id="S:0"></g></svg><script>$RC("B:0","S:0")</script>',
    'streamed',
  ],
  [
    'a segment in svg, its id spelled with a reference the scan misses',
    '<main><!--$?--><template id="B:0"></template>f<!--/$--></main><svg><g id="S&#58;0"></g></svg><script>$RC("B:0","S:0")</script>',
    'streamed segment in svg',
  ],
  [
    'a segment md-core keeps no text in',
    '<main><!--$?--><template id="B:0"></template>f<!--/$--></main><noscript id="S:0">x</noscript><script>$RC("B:0","S:0")</script>',
    'streamed segment md-core keeps no text in',
  ],
])("md-core declines what it can't see, and the tree pipeline writes it: %s", (_, html, why) => {
  const { core, tree, declined } = both(html)
  expect({ core, declined }).toEqual({ core: tree, declined: [why] })
})

test('every fixture, corpus and generated page the tree pipeline changes by moving reads the same on md-core', () => {
  const pages = [
    ...fixturePages(),
    ...corpusPages(),
    ...Array.from({ length: 2000 }, (_, i) => ({ name: `parse fuzz ${i}`, html: generate(i + 1) })),
    ...[1, 2].flatMap((seed) => {
      const next = treePages(seed)
      return Array.from({ length: 1000 }, (_, i) => ({
        name: `tree fuzz ${seed} #${i}`,
        html: next(),
      }))
    }),
  ]
  const moved: string[] = []
  const differ: string[] = []
  for (const page of pages) {
    let changes: boolean
    try {
      changes = moves(page.html)
    } catch {
      continue
    }
    if (!changes) continue
    moved.push(page.name)
    const { core, tree } = both(page.html)
    if (core !== tree) differ.push(page.name)
  }
  expect(differ).toEqual([])
  // the streamed fixtures, at least
  expect(moved.filter((name) => name.startsWith('streamed')).length).toBeGreaterThanOrEqual(4)
}, 30_000)

// whether md-core's tree, right after its moves (before anything walks it), holds an element inside itself: every
// element is reached once from the root, and no way up from one (or from what the parser still holds, which a move can
// leave outside the document) comes back to where it's been. each walk ends, so a move that made a loop fails this in
// steps, and it stops the parse there before anything else can walk the loop
const LOOP = new Error('a move made a loop')
const loops = (doc: Element, held: Element[]) => {
  const seen = new Set<Element>([doc])
  const stack: Element[] = [doc]
  while (stack.length)
    for (const kid of stack.pop()!.kids) {
      if (typeof kid === 'string') continue
      if (seen.has(kid)) return true
      seen.add(kid)
      stack.push(kid)
    }
  for (const el of [...seen, ...held]) {
    const path = new Set<Element>()
    for (let up: Element | null = el; up; up = up.up) {
      if (path.has(up)) return true
      path.add(up)
    }
  }
  return false
}
const cyclic = (html: string) => {
  onMoved((doc, held) => {
    if (loops(doc, held)) throw LOOP
  })
  try {
    parseCore(html)
    return false
  } catch (error) {
    if (error === LOOP) return true
    throw error
  } finally {
    onMoved(undefined)
  }
}

// a segment that holds the template it moves into (the template's parent, or what's above it): its children would go
// inside themselves
test.each([
  [
    'a hidden segment around a main around the template',
    '<div hidden id="S:2"><main><template id="B:2"></template></main></div><script>$RC("B:2","S:2")</script>',
  ],
  [
    'its id spelled with a reference, moved by a template',
    '<div hidden id="S&#x3a;2"><main><template id="B:2"></template><template data-rci="" data-bid="B:2" data-sid="S&#x3a;2">',
  ],
  [
    'moved by a template',
    '<div hidden id="S:2"><main><template id="B:2"></template><template data-rci="" data-bid="B:2" data-sid="S:2">',
  ],
  [
    'a section, not a main',
    '<div hidden id="S:2"><section><template id="B:2"></template></section></div><script>$RC("B:2","S:2")</script>',
  ],
  [
    'a placeholder',
    '<div id="S:1"><p><template id="P:0"></template></p></div><script>$RS("S:1","P:0")</script>',
  ],
])(
  'md-core declines a segment around its own template, as the tree pipeline reads it: %s',
  (_, html) => {
    expect(cyclic(html)).toBe(false)
    const { core, tree, declined } = both(html)
    expect({ core, declined }).toEqual({
      core: tree,
      declined: ['streamed segment holds its own template'],
    })
  },
)

test('every generated page of nested segments and templates reads as the tree pipeline does, and md-core never makes a loop', () => {
  const looped: string[] = []
  const differ: string[] = []
  let declined = 0
  for (const seed of [1, 2, 3]) {
    const next = nestedStreamedPages(seed)
    for (let i = 0; i < 1000; i++) {
      const html = next()
      if (cyclic(html)) {
        looped.push(html)
        continue
      }
      const paths = both(html)
      if (paths.core !== paths.tree) differ.push(html)
      if (paths.declined.includes('streamed segment holds its own template')) declined++
    }
  }
  expect({ looped, differ }).toEqual({ looped: [], differ: [] })
  // the class is in it, and often
  expect(declined).toBeGreaterThan(50)
}, 30_000)

// review's cycle shapes: every way a move could put an element inside itself, whatever instruction makes it
const RC = (b: string, s: string) => `<script>$RC("${b}","${s}")</script>`
const RS = (s: string, p: string) => `<script>$RS("${s}","${p}")</script>`
test.each([
  [
    'self, direct kid',
    `<div hidden id="S:0"><template id="B:0"></template></div>${RC('B:0', 'S:0')}`,
  ],
  [
    'self, depth 1 main',
    `<div hidden id="S:0"><main><template id="B:0"></template></main></div>${RC('B:0', 'S:0')}`,
  ],
  [
    'self, depth 3 main',
    `<div hidden id="S:0"><section><div><main><template id="B:0"></template></main></div></section></div>${RC('B:0', 'S:0')}`,
  ],
  [
    'self, with fallback',
    `<div hidden id="S:0"><main><!--$?--><template id="B:0"></template><p>fb</p><!--/$--></main></div>${RC('B:0', 'S:0')}`,
  ],
  [
    'self, table',
    `<table hidden id="S:0"><tbody><tr><td><template id="B:0"></template></td></tr></tbody></table>${RC('B:0', 'S:0')}`,
  ],
  [
    'self, placeholder',
    `<div hidden id="S:0"><main><template id="P:0"></template></main></div>${RS('S:0', 'P:0')}`,
  ],
  [
    'self, template instruction',
    '<div hidden id="S:0"><main><template id="B:0"></template></main></div><template data-rci="" data-bid="B:0" data-sid="S:0"></template>',
  ],
  [
    'self, rsi instruction',
    '<div hidden id="S:0"><main><template id="P:0"></template></main></div><template data-rsi="" data-pid="P:0" data-sid="S:0"></template>',
  ],
  [
    'the template is the segment',
    `<main><template id="B:0"></template></main><template id="S:0"></template>${RC('B:0', 'B:0')}`,
  ],
  [
    'the segment id is the boundary',
    `<main><div id="B:0"><template id="B:0"></template></div></main>${RC('B:0', 'B:0')}`,
  ],
  [
    'mutual',
    `<main><template id="B:0"></template></main><div hidden id="S:0"><template id="B:1"></template></div><div hidden id="S:1"><template id="B:0"></template></div>${RC('B:0', 'S:0')}${RC('B:1', 'S:1')}`,
  ],
  [
    'mutual, a main in each',
    `<div hidden id="S:0"><main><template id="B:1"></template></main></div><div hidden id="S:1"><main><template id="B:0"></template></main></div>${RC('B:0', 'S:0')}${RC('B:1', 'S:1')}`,
  ],
  [
    'mutual, segments nested',
    `<div hidden id="S:0"><div hidden id="S:1"><main><template id="B:0"></template><template id="B:1"></template></main></div></div>${RC('B:0', 'S:1')}${RC('B:1', 'S:0')}`,
  ],
  [
    'a chain of 3',
    `<div hidden id="S:0"><template id="B:1"></template></div><div hidden id="S:1"><template id="B:2"></template></div><div hidden id="S:2"><main><template id="B:0"></template></main></div>${RC('B:0', 'S:0')}${RC('B:1', 'S:1')}${RC('B:2', 'S:2')}`,
  ],
  [
    'a mixed RC and RS cycle',
    `<div hidden id="S:0"><main><template id="P:1"></template></main></div><div hidden id="S:1"><template id="B:0"></template></div>${RC('B:0', 'S:0')}${RS('S:1', 'P:1')}`,
  ],
  [
    'a cycle after a move',
    `<main><template id="B:0"></template></main><div hidden id="S:0"><section id="S:1"><p>x</p></section><template id="B:1"></template></div>${RC('B:0', 'S:0')}${RC('B:1', 'S:1')}`,
  ],
  [
    'the last segment with the id holds it',
    `<div hidden id="S:0">first</div><div hidden id="S:0"><main><template id="B:0"></template></main></div>${RC('B:0', 'S:0')}`,
  ],
  [
    '200 of them',
    Array.from(
      { length: 200 },
      (_, i) =>
        `<div hidden id="S:${i}"><main><template id="B:${i}"></template></main></div>${RC(`B:${i}`, `S:${i}`)}`,
    ).join(''),
  ],
])(
  'no move puts an element inside itself, and md-core reads it as the tree pipeline does: %s',
  (_, html) => {
    expect(cyclic(html)).toBe(false)
    const { core, tree } = both(html)
    expect(core).toBe(tree)
  },
)
