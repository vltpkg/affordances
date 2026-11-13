import { afterEach, expect, test } from 'vitest'
import { htmlToMarkdown, readPage } from '../../../src/index.ts'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { flightStripper, readStreamed } from '../../../src/convert/index.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

const page = '<main><h1>Hi</h1><p>Some <em>text</em>.</p></main>'

test('md-core is the default, and writes what the tree pipeline does', () => {
  forcePath('hast')
  const tree = htmlToMarkdown(page, { url: 'https://shop.test/page' })
  forcePath(undefined)
  expect(htmlToMarkdown(page, { url: 'https://shop.test/page' })).toEqual(tree)
  // a page reaches md-core: one it declines is counted
  htmlToMarkdown('<template id="B:0"></template><script>$RC("B:0","S:0")</script>')
  expect(declines.get('streamed')).toBe(1)
  declines.clear()
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
  const slotted =
    '<main><p>a</p><template id="B:0"></template></main><div hidden id="S:0">b</div><script>$RC("B:0","S:0")</script>'
  forcePath('hast')
  const tree = htmlToMarkdown(slotted)
  expect(declines.size).toBe(0)
  forcePath('core')
  expect(htmlToMarkdown(slotted)).toEqual(tree)
  expect(declines.get('streamed')).toBe(1)
  forcePath('strict')
  expect(() => readPage(slotted)).toThrow(/md-core declined the page \(streamed\)/)
  // unless that decline is allowed
  forcePath('strict', ['streamed'])
  expect(readPage(slotted).markdown().markdown).toBe(tree.markdown)
})

test('an element named like a selector, which the tree pipeline renames, declines the page', () => {
  const push = '<script#x>self.__next_f.push([1,"0:{}\\n"])</script#x>'
  for (const html of [
    '<main><a#x href="/l">link</a#x><p.y>para</p.y></main>',
    `<main><p>a</p>${push}</main>`,
  ]) {
    forcePath('hast')
    const tree = htmlToMarkdown(html).markdown
    forcePath('core')
    declines.clear()
    expect(htmlToMarkdown(html).markdown).toBe(tree)
    expect(Object.fromEntries(declines)).toEqual({ 'selector tag name': 1 })
  }
  // on the handler's path, the push in what the tree pipeline reads as a script is never trusted, on either path
  const strip = flightStripper()
  const kept = strip.write(`<main><p>a</p>${push}</main>`) + strip.end()
  for (const path of ['hast', 'core'] as const) {
    forcePath(path)
    expect(() => readStreamed(kept, strip.swapped())).toThrow(/unswapped/)
  }
})
