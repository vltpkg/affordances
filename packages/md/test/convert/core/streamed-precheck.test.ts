import { afterEach, expect, test, vi } from 'vitest'
import { parse as parseCore } from '../../../src/convert/core/parse.ts'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { htmlToMarkdown } from '../../../src/index.ts'
import { mayStream } from '../../../src/convert/index.ts'
import { corpusPages, fixturePages } from './emit-pages.ts'
import { treePages } from './tree-fuzz.ts'

// md-core's reading of a page, counted: a page the scan sends to the tree pipeline must never reach it. the tree
// pipeline asks md-core's parser only where a page too deep is cut, without its streamed moves, which isn't counted
const parses = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../../src/convert/core/parse.ts', async (original) => {
  const actual = await original<typeof import('../../../src/convert/core/parse.ts')>()
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      if (args[2] !== false) parses.count++
      return actual.parse(...args)
    },
  }
})

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

// streamed boundaries md-core can't move: through a template in svg, or to a segment found there
const SVG_SHAPES = [
  '<main><svg><!--$?--><template id="B:0"></template>f<!--/$--></svg></main><div hidden id="S:0">x</div><script>$RC("B:0","S:0")</script>',
  '<main><!--$?--><template id="B:0"></template>f<!--/$--></main><svg><g id="S:0"></g></svg><script>$RC("B:0","S:0")</script>',
  '<main><template id="P:0"></template></main><svg><g id="S:1"></g></svg><template data-rsi="" data-pid="P:0" data-sid="S:1"></template>',
]

test('a streamed page md-core would only decline goes to the tree pipeline before md-core parses it', () => {
  forcePath('core')
  for (const html of SVG_SHAPES) {
    parses.count = 0
    declines.clear()
    expect(mayStream(html)).toBe(true)
    htmlToMarkdown(html)
    expect({ parses: parses.count, declined: [...declines.keys()] }).toEqual({
      parses: 0,
      declined: ['streamed'],
    })
  }
  // and a streamed page md-core moves is md-core's, parsed once
  const streamed = fixturePages().filter((page) => page.name.startsWith('streamed-'))
  expect(streamed.length).toBeGreaterThanOrEqual(4)
  for (const page of streamed) {
    parses.count = 0
    declines.clear()
    htmlToMarkdown(page.html)
    expect({ page: page.name, parses: parses.count, declined: [...declines.keys()] }).toEqual({
      page: page.name,
      parses: 1,
      declined: [],
    })
  }
})

test("the scan is a superset of md-core's streamed declines on every fixture, corpus and generated page", () => {
  const pages = [
    ...fixturePages().map((page) => page.html),
    ...corpusPages().map((page) => page.html),
    ...SVG_SHAPES,
    ...[1, 2, 3].flatMap((seed) => {
      const next = treePages(seed)
      return Array.from({ length: 1000 }, () => next())
    }),
  ]
  const declined = pages.filter((html) => parseCore(html).streamed)
  expect(declined.filter((html) => !mayStream(html))).toEqual([])
  // the svg shapes, at least, are in it
  expect(declined.length).toBeGreaterThanOrEqual(SVG_SHAPES.length)
})

// an instruction template inside svg, which the tree pipeline reads and md-core keeps nothing of, in every spelling
const boundary = (instruction: string) =>
  `<!doctype html><main><!--$?--><template id="B:0"></template><p>loading</p><!--/$-->${instruction}<div hidden id="S:0"><p>streamed</p></div></main>`
const placeholder = (instruction: string) =>
  `<!doctype html><main><template id="P:0"></template>${instruction}<div hidden id="S:0"><p>streamed</p></div></main>`
test.each([
  [
    'as react writes it',
    boundary('<svg><template data-rci="" data-bid="B:0" data-sid="S:0"></template></svg>'),
    'scan',
  ],
  [
    'an uppercase svg',
    boundary('<SVG><template data-rci="" data-bid="B:0" data-sid="S:0"></template></SVG>'),
    'parse',
  ],
  [
    'an uppercase template',
    boundary('<svg><TEMPLATE data-rci="" data-bid="B:0" DATA-SID="S:0"></TEMPLATE></svg>'),
    'parse',
  ],
  [
    'single quotes',
    boundary("<svg><TEMPLATE data-rci data-bid='B:0' data-sid='S:0'></TEMPLATE></svg>"),
    'parse',
  ],
  [
    'a tab after svg',
    boundary('<svg\t><TEMPLATE data-rci="" data-bid="B:0" data-sid="S:0"></TEMPLATE></svg>'),
    'parse',
  ],
  [
    'self-closed',
    boundary('<svg><template data-rci data-bid="B:0" data-sid="S:0"/></svg>'),
    'scan',
  ],
  [
    'self-closed, uppercase',
    boundary('<SVG><TEMPLATE DATA-RCI DATA-BID=B:0 DATA-SID=S:0 /></SVG>'),
    'parse',
  ],
  [
    'a placeholder, unquoted',
    placeholder('<svg><TEMPLATE data-rsi data-pid="P:0" data-sid=S:0></TEMPLATE></svg>'),
    'parse',
  ],
  [
    'in math',
    boundary('<math><template data-rci="" data-bid="B:0" data-sid="S:0"></template></math>'),
    'moves',
  ],
])('an instruction template in svg converts as the tree pipeline does: %s', (_, html, by) => {
  forcePath('core')
  parses.count = 0
  declines.clear()
  const core = htmlToMarkdown(html).markdown
  const read = { scan: mayStream(html), parses: parses.count, declined: [...declines.keys()] }
  forcePath('hast')
  expect(core).toBe(htmlToMarkdown(html).markdown)
  // the scan sends react's own spelling to the tree pipeline; md-core declines any other once it has parsed it, and
  // moves what's in math, which it keeps
  expect(read).toEqual(
    by === 'scan'
      ? { scan: true, parses: 0, declined: ['streamed'] }
      : by === 'parse'
        ? { scan: false, parses: 1, declined: ['streamed instruction in svg'] }
        : { scan: false, parses: 1, declined: [] },
  )
})

test('a page the scan misses still declines inside md-core, after its parse', () => {
  // the segment's id spelled with a reference, in svg: the scan can't see it, md-core's parser can
  const html =
    '<main><!--$?--><template id="B:0"></template>f<!--/$--></main><svg><g id="S&#58;0"></g></svg><script>$RC("B:0","S:0")</script>'
  expect(mayStream(html)).toBe(false)
  forcePath('core')
  parses.count = 0
  const core = htmlToMarkdown(html).markdown
  expect([parses.count, [...declines.keys()]]).toEqual([1, ['streamed segment in svg']])
  forcePath('hast')
  expect(core).toBe(htmlToMarkdown(html).markdown)
})
