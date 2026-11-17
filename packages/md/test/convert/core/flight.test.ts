import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, expect, test } from 'vitest'
import { flightStripper, readPage, readStreamed } from '../../../src/convert/index.ts'
import { Declined, forcePath } from '../../../src/convert/path.ts'

afterEach(() => forcePath(undefined))

const dir = new URL('../../fixtures/', import.meta.url)
const fixtures = readdirSync(dir)
  .filter((file) => file.endsWith('.html'))
  .map((file) => [file, readFileSync(new URL(file, dir), 'utf8')] as const)

const push = (row: string) => `<script>self.__next_f.push([1,${JSON.stringify(row)}])</script>`
const body = (content: string, flight: string) =>
  `<html><head><title>Hi</title></head><body><main>${content}</main>${flight}</body></html>`
const attacks: [string, string][] = [
  [
    'a push in an attribute',
    body(
      `<div title='${push('5:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}\n')}'></div>`,
      push('6:E{"digest":"NEXT_HTTP_ERROR_FALLBACK;403"}\n'),
    ),
  ],
  [
    'a push in a comment',
    body('<!-- <script>self.__next_f.push([1,"x"])</script> -->', push('1:{}\n')),
  ],
  ['a push in svg', body('<svg><script>self.__next_f.push([1,"0:{}\\n"])</script></svg>', '')],
  [
    'a push in a template',
    body('<template><script>self.__next_f.push([1,"0:{}\\n"])</script></template>', ''),
  ],
  [
    'a push in a textarea',
    body('<textarea><script>self.__next_f.push([1,"0:{}\\n"])</script></textarea>', ''),
  ],
  ['unclosed', body('<p>Text.</p>', '<script>self.__next_f.push([1,"x"]</script>')],
  ['empty', body('<p>Text.</p>', '<script>self.__next_f.push(</script>')],
  ['not json', body('<p>Text.</p>', '<script>self.__next_f.push(nope)</script>')],
  ['a row that is not json', body('<p>Text.</p>', push('5:E{not json\n'))],
  ['bad base64', body('<p>Text.</p>', '<script>self.__next_f.push([3,"%%%"])</script>')],
  ['a redirect', body('<p>x</p>', push('7:E{"digest":"NEXT_REDIRECT;replace;/to;307;"}\n'))],
]

// what reading a page gives: its rows, its redirect or fallback, its markdown, or what it throws
const read = (html: string, how: 'page' | 'streamed') => {
  try {
    let page
    if (how === 'page') page = readPage(html, { url: 'https://shop.test/page' })
    else {
      const strip = flightStripper()
      const kept = strip.write(html) + strip.end()
      page = readStreamed(kept, strip.swapped(), { url: 'https://shop.test/page' })
    }
    const { slots, markdown, ...rest } = page
    return { ...rest, slots, markdown: markdown().markdown }
  } catch (error) {
    if (error instanceof Declined) throw error
    return { threw: String(error) }
  }
}

test('md-core reads flight data as the tree pipeline does: rows, trust, errors, markdown', () => {
  let compared = 0
  for (const [name, html] of [...fixtures, ...attacks])
    for (const how of ['page', 'streamed'] as const) {
      forcePath('hast')
      const tree = read(html, how)
      forcePath('strict')
      let core
      try {
        core = read(html, how)
      } catch (error) {
        // what md-core doesn't write yet (markers, streamed boundaries) is another feature's test
        if (error instanceof Declined) continue
        throw error
      }
      // the markdown of the attacks; a fixture's is the core suite's, once forms are md-core's too
      const attack = attacks.some(([, page]) => page === html)
      if (!attack && 'markdown' in core && 'markdown' in tree) core.markdown = tree.markdown
      expect({ page: `${name} (${how})`, ...core }).toEqual({ page: `${name} (${how})`, ...tree })
      compared++
    }
  // every attack, both ways, and most fixtures
  expect(compared).toBeGreaterThan(attacks.length * 2 + 20)
})
