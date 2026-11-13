import { afterEach, expect, test } from 'vitest'
import { declines, forcePath } from '../../../src/convert/path.ts'
import { htmlToMarkdown, readPage, type Options } from '../../../src/index.ts'

afterEach(() => {
  forcePath(undefined)
  declines.clear()
})

// a malformed page through md on both paths (htmlToMarkdown, and readPage with a fill): what md-core writes, what the
// tree pipeline writes, and why md-core declined it, if it did
const read = (html: string, options: Options) => {
  const page = readPage(html, options)
  const { markdown, ...rest } = page
  return JSON.stringify([htmlToMarkdown(html, options), rest, markdown({ a: 'F' })])
}
const both = (html: string, options: Options = {}) => {
  forcePath('hast')
  const tree = read(html, options)
  forcePath('core')
  declines.clear()
  const core = read(html, options)
  return { core, tree, declined: [...declines.keys()] }
}

// a <template> in svg or math has children and no content; hast-util-from-parse5 used to throw on one
test.each([
  ['in svg', '<p>a</p><svg><template><p>x</p></template></svg><p>b</p>'],
  ['in math', '<p>a</p><math><template><mi>x</mi></template></math><p>b</p>'],
  ['in math, in a template', '<template><math><template>t</template></math></template><p>b</p>'],
  [
    'with a push in it',
    '<p>a</p><svg><template><script>self.__next_f.push([1,"0:{}\\n"])</script></template></svg>',
  ],
])('a foreign template never throws, on either path: %s', (_, html) => {
  const { core, tree } = both(html)
  expect(tree).toBe(core)
  expect(tree).not.toContain('THROW')
})

test("only the templates md renamed are named back: a page's own element of that name stays as it is", () => {
  const html =
    '<main><p>a</p><svg><template></template></svg><affordances-foreign-template>visible to people</affordances-foreign-template></main>'
  const { core, tree } = both(html)
  expect(tree).toBe(core)
  expect(tree).toContain('visible to people')
})
