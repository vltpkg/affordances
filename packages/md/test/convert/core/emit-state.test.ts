import { expect, test } from 'vitest'
import { LINK, Md, PARAGRAPH, renderBlock, TEXT } from '../../../src/convert/core/emit-markdown.ts'
import { htmlToMarkdown } from '../../../src/index.ts'

// md-core's serializer keeps the constructs it's in as module state. an error thrown while it writes (here, in a
// link's label, as a block is written on the way) never decides how the next page is written: escaping there is the
// next page's own
const pages = [
  '<main><ul><li>x]y</li><li>b</li></ul></main>',
  '<main><h2>x]y</h2><p>x]y and a#</p></main>',
  '<main><table><tr><td>x]y</td></tr></table></main>',
]
test('an error in the middle of writing a block leaves nothing behind for the next page', () => {
  const fresh = pages.map((page) => htmlToMarkdown(page).markdown)
  const broken = new Md(TEXT, undefined, 'x')
  Object.defineProperty(broken, 'value', {
    get() {
      throw new RangeError('mid-write')
    },
  })
  const link = new Md(LINK, [new Md(TEXT, undefined, 'a'), broken])
  link.url = '/x'
  for (const [i, page] of pages.entries()) {
    expect(() => renderBlock(new Md(PARAGRAPH, [new Md(TEXT, undefined, 'see '), link]))).toThrow(
      'mid-write',
    )
    expect(htmlToMarkdown(page).markdown).toBe(fresh[i])
  }
  expect(fresh[0]).toBe('- x]y\n- b\n')
})
