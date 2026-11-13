import { afterEach, expect, test, vi } from 'vitest'
import { parse as parseCore } from '../../../src/convert/core/parse.ts'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { htmlToMarkdown } from '../../../src/index.ts'
import { mayStream } from '../../../src/convert/index.ts'
import { corpusPages, fixturePages } from './emit-pages.ts'

// md-core's parse, counted: a streamed page must never reach it
const parses = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../../src/convert/core/parse.ts', async (original) => {
  const actual = await original<typeof import('../../../src/convert/core/parse.ts')>()
  return {
    ...actual,
    parse: (html: string) => {
      parses.count++
      return actual.parse(html)
    },
  }
})

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

test('a page with react streamed instructions goes to the tree pipeline before md-core parses it', () => {
  forcePath('core')
  const streamed = fixturePages().filter((page) => page.name.startsWith('streamed-'))
  const scanned = streamed.filter((each) => mayStream(each.html))
  // the four streamed fixtures, at least: an empty list would pass this as easily
  expect(scanned.length).toBeGreaterThanOrEqual(4)
  for (const page of scanned) {
    parses.count = 0
    declines.clear()
    htmlToMarkdown(page.html)
    expect({ page: page.name, parses: parses.count, declined: [...declines.keys()] }).toEqual({
      page: page.name,
      parses: 0,
      declined: ['streamed'],
    })
  }
  // and a page without them is md-core's, parsed once
  parses.count = 0
  htmlToMarkdown('<main><p>plain</p></main>')
  expect(parses.count).toBe(1)
})

test("the scan is a superset of md-core's own check on every fixture and corpus page", () => {
  const pages = [...fixturePages(), ...corpusPages()]
  const missed = pages.filter((page) => parseCore(page.html).streamed && !mayStream(page.html))
  expect(missed.map((page) => page.name)).toEqual([])
  // the streamed fixtures, at least, are in it
  expect(pages.filter((page) => parseCore(page.html).streamed).length).toBeGreaterThanOrEqual(4)
})

test('a page the scan misses still declines inside md-core, after its parse', () => {
  // the instruction spelled with a reference, in svg: the scan can't see it, md-core's parser can
  const html =
    '<!--$?--><template id="B:3"></template>f<!--/$--><div hidden id="S:5">z</div><svg><script>&#36;RC("B:3","S:5")</script></svg>'
  expect(mayStream(html)).toBe(false)
  forcePath('core')
  parses.count = 0
  const core = htmlToMarkdown(html).markdown
  expect([parses.count, [...declines.keys()]]).toEqual([1, ['streamed']])
  forcePath('hast')
  expect(core).toBe(htmlToMarkdown(html).markdown)
})
