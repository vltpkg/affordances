import type { Element, Root } from 'hast'
import { fromParse5 } from 'hast-util-from-parse5'
import { parse as parseHtml } from 'parse5'
import { describe, expect, test } from 'vitest'
import { parse } from '../../../src/convert/core/parse.ts'
import { corpusPages, fixturePages } from './emit-pages.ts'
import { generate } from './parse-fuzz.ts'

// the flight check reads every script's own text: md-core's parser has to find the same scripts, with the same text,
// as the tree pipeline does in parse5's tree (the template's content and a removed body aren't in it)
const oracle = (html: string) => {
  const tree = fromParse5(parseHtml(html, { scriptingEnabled: false })) as Root
  const texts: string[] = []
  const walk = (parent: Root | Element) => {
    for (const node of parent.children) {
      if (node.type !== 'element') continue
      if (node.tagName === 'script')
        texts.push(node.children.map((kid) => (kid.type === 'text' ? kid.value : '')).join(''))
      walk(node)
    }
  }
  walk(tree)
  return texts.toSorted()
}
const found = (html: string) => parse(html).scripts.toSorted()

describe('every script, with its own text', () => {
  test.each([
    ['in head and body', '<head><script>a</script></head><body><script>b</script><p>x</p></body>'],
    ['inside svg, around an element', '<svg><script>a&amp;<g>inner</g>b</script></svg>'],
    ['inside svg, self-closed', '<svg><script/></svg><p>x</p>'],
    ['inside math', '<math><script>m</script></math>'],
    ['inside a template', '<template><script>t</script></template><script>out</script>'],
    ['in a body a frameset threw out', '<body><script>gone</script><frameset></frameset>'],
    ['in a table', '<table><script>t</script><tr><td><script>c</script></td></tr></table>'],
    ['in noscript, with scripting off', '<noscript><script>n</script></noscript>'],
    ['in a comment, which is none', '<!-- <script>no</script> --><script>yes</script>'],
    ['nul characters', '<script>a\0b</script><svg><script>c\0d</script></svg>'],
    ['after the html end', '</html><script>late</script>'],
    ['escaped script data', '<script><!--<script>x</script>y--></script>'],
  ])('%s', (_, html) => {
    expect(found(html)).toEqual(oracle(html))
  })
})

test('the fixtures and the corpus', () => {
  for (const page of [...fixturePages(), ...corpusPages()])
    expect({ page: page.name, scripts: found(page.html) }).toEqual({
      page: page.name,
      scripts: oracle(page.html),
    })
})

test('6000 generated pages', () => {
  const failures: string[] = []
  for (let seed = 1; seed <= 6000; seed++) {
    const html = generate(seed)
    let expected: string[]
    try {
      expected = oracle(html)
    } catch {
      continue
    }
    const actual = found(html)
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      failures.push(`seed ${seed} ${JSON.stringify(html)}: ${JSON.stringify(actual)}`)
  }
  expect(failures.slice(0, 5)).toEqual([])
})
