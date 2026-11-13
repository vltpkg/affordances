import { afterEach, expect, test } from 'vitest'
import { htmlToMarkdown, readPage } from '../../../src/index.ts'
import { declines, forcePath } from '../../../src/convert/path.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

const page = '<main><h1>Hi</h1><p>Some <em>text</em>.</p></main>'

test('md-core and the tree pipeline write the same markdown for a page both can convert', () => {
  const tree = htmlToMarkdown(page, { url: 'https://shop.test/page' })
  forcePath('strict')
  expect(htmlToMarkdown(page, { url: 'https://shop.test/page' })).toEqual(tree)
  expect(declines.size).toBe(0)
})

test('handlers and a function extract take the tree pipeline, without a decline', () => {
  forcePath('strict')
  const custom = htmlToMarkdown(page, {
    handlers: { em: () => ({ type: 'text', value: 'custom' }) },
  })
  expect(custom.markdown).toContain('Some custom.')
  const extracted = htmlToMarkdown(page, { extract: (tree) => tree })
  expect(extracted.markdown).toContain('# Hi')
  expect(declines.size).toBe(0)
})

test('a page md-core declines is counted, and the tree pipeline writes it; strict throws instead', () => {
  const marked =
    '<main><affordances-md data-mode="skip"><p>skip</p></affordances-md><p>kept</p></main>'
  const tree = htmlToMarkdown(marked)
  forcePath('core')
  expect(htmlToMarkdown(marked)).toEqual(tree)
  expect(declines.get('marker')).toBe(1)
  forcePath('strict')
  expect(() => readPage(marked)).toThrow(/md-core declined the page \(marker\)/)
})
