import { afterEach, expect, test, vi } from 'vitest'
import { CUT } from '../../../src/convert/depth.ts'
import { forcePath } from '../../../src/convert/path.ts'
import { htmlToMarkdown, readPage } from '../../../src/index.ts'

// md-core's parser as one that never says where a page nests too deep: the tree pipeline then has only parse5's own
// count to cut by
vi.mock('../../../src/convert/core/parse.ts', async (original) => {
  const actual = await original<typeof import('../../../src/convert/core/parse.ts')>()
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => ({
      ...actual.parse(...args),
      cut: undefined,
    }),
  }
})

afterEach(() => {
  forcePath(undefined)
})

// a page parse5 nests past CUT is cut where parse5 does, even when md-core's parser read it whole
test.each([
  ['divs', (n: number) => '<div>'.repeat(n)],
  ['table cells', (n: number) => '<table><td>'.repeat(n)],
])('the tree pipeline cuts a page of nested %s by parse5 alone', (_, nest) => {
  const html = `<main><p>top</p>${nest(CUT * 20)}deep</main>`
  forcePath('hast')
  expect(htmlToMarkdown(html).markdown).toMatch(/^top\n/)
  const page = readPage(html)
  expect(page.cut).toBe(true)
  expect(page.markdown().markdown).toMatch(/^top\n/)
  expect(page.markdown().markdown).not.toContain('deep')
})
