import type { Root } from 'hast'
import { fromParse5 } from 'hast-util-from-parse5'
import { parse as parseHtml } from 'parse5'
import { expect, test } from 'vitest'
import { parse } from '../../../src/convert/core/parse.ts'
import { resolveStreamed } from '../../../src/convert/index.ts'
import { corpusPages, fixturePages } from './emit-pages.ts'
import { generate } from './parse-fuzz.ts'

// md-core doesn't move react's streamed boundaries into place, so it must decline every page the tree pipeline
// would change by moving them: it declines a page with a <template id>, the only way resolveStreamed moves anything
const moves = (html: string) => {
  const tree = fromParse5(parseHtml(html, { scriptingEnabled: false })) as Root
  const before = JSON.stringify(tree)
  resolveStreamed(tree).resolve()
  return JSON.stringify(tree) !== before
}
const declines = (html: string) => parse(html).streamed

const streamed = [
  // a boundary and a placeholder, by script and by the external runtime's templates
  '<div><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--></div><div hidden id="S:0"><p>Done</p></div><script>$RC("B:0","S:0")</script>',
  '<p><template id="P:1"></template></p><div hidden id="S:1">x</div><script>$RS("S:1","P:1")</script>',
  '<!--$?--><template id="B:1"></template>fallback<!--/$--><div hidden id="S:2">real</div><template data-rci="" data-bid="B:1" data-sid="S:2"></template>',
  '<template id="P:2"></template><div hidden id="S:3">y</div><template data-rsi="" data-pid="P:2" data-sid="S:3"></template>',
  // a boundary resolved with its stylesheets, an instruction in svg spelled with a reference, a template's id in
  // another case, and an attribute that holds a >
  '<!--$?--><template id="B:2"></template>f<!--/$--><div hidden id="S:4">z</div><script>$RR("B:2","S:4",[])</script>',
  '<!--$?--><template id="B:3"></template>f<!--/$--><div hidden id="S:5">z</div><svg><script>&#36;RC("B:3","S:5")</script></svg>',
  '<!--$?--><TEMPLATE ID="B:4"></TEMPLATE>f<!--/$--><div hidden id="S:6">z</div><script>$RC("B:4","S:6")</script>',
  '<!--$?--><template title="a>b" id="B:5"></template>f<!--/$--><div hidden id="S:7">z</div><script>$RC("B:5","S:7")</script>',
]

test('the streamed shapes are moved by the tree pipeline, and md-core declines each', () => {
  for (const html of streamed)
    expect({ html, moves: moves(html), declines: declines(html) }).toEqual({
      html,
      moves: true,
      declines: true,
    })
})

test('every fixture and corpus page the tree pipeline changes by moving is one md-core declines', () => {
  const pages = [...fixturePages(), ...corpusPages()]
  const moved = pages.filter((page) => moves(page.html))
  expect(moved.filter((page) => !declines(page.html)).map((page) => page.name)).toEqual([])
  // the streamed fixtures, at least (the corpus is fetched, so it may not be there)
  expect(fixturePages().filter((page) => moves(page.html)).length).toBeGreaterThanOrEqual(4)
})

test('and every generated page', () => {
  const missed: number[] = []
  for (let seed = 1; seed <= 6000; seed++) {
    const html = generate(seed)
    let moved: boolean
    try {
      moved = moves(html)
    } catch {
      continue
    }
    if (moved && !declines(html)) missed.push(seed)
  }
  expect(missed).toEqual([])
})
