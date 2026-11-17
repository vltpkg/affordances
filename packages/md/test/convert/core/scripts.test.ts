import { parse as parseHtml } from 'parse5'
import { describe, expect, test } from 'vitest'
import { parse } from '../../../src/convert/core/parse.ts'
import { corpusPages, fixturePages } from './emit-pages.ts'
import { generate } from './parse-fuzz.ts'

// the flight check reads every script's own text: md-core's parser has to find the same scripts, with the same text,
// as the tree pipeline does in parse5's tree (the template's content and a removed body aren't in it), and the same
// ones a browser never runs: in a <noscript> (text, with scripting on) or in mathml, where a script isn't html's
type Parse5Node = {
  tagName?: string
  namespaceURI?: string
  value?: string
  childNodes?: Parse5Node[]
}
const oracle = (html: string) => {
  const runs: string[] = []
  const unrun: string[] = []
  const walk = (parent: Parse5Node, hidden: boolean) => {
    for (const node of parent.childNodes ?? []) {
      if (!node.tagName) continue
      if (node.tagName === 'script') {
        const text = (node.childNodes ?? []).map((kid) => kid.value ?? '').join('')
        ;(hidden || node.namespaceURI === 'http://www.w3.org/1998/Math/MathML' ? unrun : runs).push(
          text,
        )
      }
      walk(
        node,
        hidden ||
          (node.tagName === 'noscript' && node.namespaceURI === 'http://www.w3.org/1999/xhtml'),
      )
    }
  }
  walk(parseHtml(html, { scriptingEnabled: false }) as Parse5Node, false)
  return { runs: runs.toSorted(), unrun: unrun.toSorted() }
}
const found = (html: string) => {
  const { scripts, unrun } = parse(html)
  return { runs: scripts.toSorted(), unrun: unrun.toSorted() }
}

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
    [
      'in noscript, deeper',
      '<noscript><p><b><script>n</script></b></p></noscript><script>y</script>',
    ],
    ['in a head noscript', '<head><noscript><script>h</script></noscript></head><body>x</body>'],
    ['in math, deeper', '<math><mrow><script>m</script></mrow></math>'],
    ['in math, at a text integration point', '<math><mi><script>i</script></mi></math>'],
    [
      'in an html annotation-xml',
      '<math><annotation-xml encoding="text/html"><script>a</script></annotation-xml></math>',
    ],
    ['in svg in noscript', '<noscript><svg><script>s</script></svg></noscript>'],
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

// about a second; more on a loaded machine running both vitest projects at once
test('6000 generated pages', { timeout: 30_000 }, () => {
  const failures: string[] = []
  for (let seed = 1; seed <= 6000; seed++) {
    const html = generate(seed)
    let expected: ReturnType<typeof oracle>
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
