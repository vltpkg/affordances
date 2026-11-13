import { expect, test } from 'vitest'
import { htmlToMarkdown as core } from '../../../src/convert/core/index.ts'
import { htmlToMarkdown } from '../../../src/index.ts'

// md-core against the tree pipeline, on what markers keep and leave out
const same = (html: string) =>
  expect(core(html, { url: 'https://shop.test/page' }).markdown).toBe(
    htmlToMarkdown(html, { url: 'https://shop.test/page' }).markdown,
  )

test('on an element that is not a marker, data-affordances-md keeps nothing hidden but show', () => {
  for (const mode of ['only', 'main', 'text', 'slot', 'values', ''])
    for (const hide of ['hidden', 'style="display:none"', 'aria-hidden="true"']) {
      same(`<main><p>a</p><div ${hide} data-affordances-md="${mode}">LEAK</div></main>`)
      same(`<p>a</p><nav ${hide} data-affordances-md="${mode}">LEAK</nav>`)
    }
  // chrome stays out of a page without a main, unless it's shown
  same(
    '<p>a</p><nav data-affordances-md="only">LEAK</nav><nav data-affordances-md="show">kept</nav>',
  )
  expect(
    core('<main><div hidden data-affordances-md="only">LEAK</div></main>').markdown,
  ).not.toContain('LEAK')
})
