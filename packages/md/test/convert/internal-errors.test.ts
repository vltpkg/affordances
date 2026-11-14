import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { declines, forcePath, PARITY, SECURITY } from '../../src/convert/path.ts'
import { FlightDataError, readStreamed } from '../../src/convert/index.ts'
import { htmlToMarkdown, readPage } from '../../src/index.ts'

// errors md didn't foresee, switched on per test: md-core's parse as it reads a page (not the tree pipeline's call for
// where to cut, which reads no further), md-core's emit (markdown()), and the tree pipeline's hast-util-from-parse5
const boom = vi.hoisted(() => ({ parse: false, emit: false, tree: false }))
vi.mock('../../src/convert/core/parse.ts', async (original) => {
  const actual = await original<typeof import('../../src/convert/core/parse.ts')>()
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      if (boom.parse && args[2] !== false) throw new TypeError('md-core parse broke')
      return actual.parse(...args)
    },
  }
})
vi.mock('../../src/convert/core/emit.ts', async (original) => {
  const actual = await original<typeof import('../../src/convert/core/emit.ts')>()
  return {
    ...actual,
    emit: (...args: Parameters<typeof actual.emit>) => {
      if (boom.emit) throw new RangeError('md-core emit broke')
      return actual.emit(...args)
    },
  }
})
vi.mock('hast-util-from-parse5', async (original) => {
  const actual = await original<typeof import('hast-util-from-parse5')>()
  return {
    ...actual,
    fromParse5: (...args: Parameters<typeof actual.fromParse5>) => {
      if (boom.tree) throw new SyntaxError('tree pipeline broke')
      return actual.fromParse5(...args)
    },
  }
})

// md's own choice of path, md-core first, in both of vitest's projects
beforeEach(() => forcePath(undefined))
afterEach(() => {
  boom.parse = boom.emit = boom.tree = false
  declines.clear()
})

// what a page reads as, or the error its markdown() throws: readPage itself never throws
const outcome = (html: string, options = {}) => {
  const page = readPage(html, options)
  try {
    return { markdown: page.markdown().markdown, same: htmlToMarkdown(html, options).markdown }
  } catch (error) {
    let again: unknown
    try {
      htmlToMarkdown(html, options)
    } catch (thrown) {
      again = thrown
    }
    return { threw: (error as Error).message, again: (again as Error | undefined)?.message }
  }
}

const plain = '<main><h1>Title</h1><p>Body</p></main>'

test('a page md-core throws on is read on the tree pipeline, at read and at markdown()', () => {
  const expected = { markdown: '# Title\n\nBody\n', same: '# Title\n\nBody\n' }
  boom.parse = true
  expect(outcome(plain)).toEqual(expected)
  boom.parse = false
  boom.emit = true
  expect(outcome(plain)).toEqual(expected)
})

test('when both paths throw, markdown() and htmlToMarkdown throw the first error, unchanged', () => {
  boom.parse = true
  boom.tree = true
  expect(outcome(plain)).toEqual({ threw: 'md-core parse broke', again: 'md-core parse broke' })
})

test("the tree pipeline's error stands on a page md-core declined for anything but parity", () => {
  boom.tree = true
  // a form in a strikethrough: security (what a form says)
  expect(outcome('<del><form><nobr>f\t')).toEqual({
    threw: 'tree pipeline broke',
    again: 'tree pipeline broke',
  })
  // a page with a parity reason and, past it, a security one (a slot under a value)
  expect(
    outcome(
      '<ul><s>*a*</s></ul><h2><optgroup><affordances-md data-mode="slot" data-name="a">x</affordances-md></optgroup></h2>',
    ),
  ).toEqual({ threw: 'tree pipeline broke', again: 'tree pipeline broke' })
})

test("on a page md-core declined only for parity, md-core's own markdown is the answer when the tree pipeline throws", () => {
  boom.tree = true
  const read = outcome('<ul><s>*a*')
  expect(read).toEqual({ markdown: expect.any(String), same: read.markdown })
  expect(read.markdown).toContain('a')
  expect(declines.get('tree path threw')).toBeGreaterThan(0)
})

// swaps that can't be trusted fail closed on every path, md-core's past the parity declines too: a page that only kept
// the paths byte-identical (a nobr split), where the tree pipeline then throws, is no way around the trust check
test('a page streamed with untrusted swaps throws FlightDataError, however md reads it', () => {
  boom.tree = true
  const swapped = { nonce: crypto.randomUUID(), count: 1, errors: [], unreadable: false }
  for (const html of ['<main><nobr>a <!-- c --> b</nobr></main>', '<main><p>a b</p></main>']) {
    let thrown: unknown
    try {
      readStreamed(html, swapped).markdown()
    } catch (error) {
      thrown = error
    }
    expect([html, thrown instanceof FlightDataError && thrown.reason]).toEqual([html, 'count'])
  }
})

// review's 82 bytes: a form in a strikethrough (security), and parse5 throws on the page
test('the page parse5 throws on: readPage returns, markdown() throws its error', () => {
  const html = '<table><svg><select><foreignObject><select><td><article><span></ul><svg><del><form>'
  const page = readPage(html)
  expect([page.slots, page.errors]).toEqual([{ unique: [], duplicate: [] }, []])
  expect(() => page.markdown()).toThrow(/reading 'tagName'/)
  expect(() => htmlToMarkdown(html)).toThrow(/reading 'tagName'/)
})

// every reason md-core declines a page for is tagged, parity or security: a new one fails here until it is
test('every decline reason is tagged parity or security, and none is both', () => {
  const dir = new URL('../../src/convert/', import.meta.url)
  const sources = [
    ...['index.ts'].map((f) => new URL(f, dir)),
    ...readdirSync(new URL('core/', dir))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => new URL(`core/${f}`, dir)),
  ].map((url) => readFileSync(url, 'utf8'))
  const found = new Set<string>()
  for (const source of sources) {
    for (const [, why] of source.matchAll(/\bdeclined\(\s*'([^']+)'/g)) found.add(why!)
    for (const [, , why] of source.matchAll(/\bdecline\(\s*(['"])(.+?)\1\)/g)) found.add(why!)
    for (const [, , why] of source.matchAll(/decline \?\?= (['"])(.+?)\1/g)) found.add(why!)
    for (const [, why] of source.matchAll(/return '(streamed[^']*)'/g)) found.add(why!)
  }
  // the templated ones
  found.add('slot inside <table>').add('slot inside a tablist')
  // the emitter's fast path, which falls back inside md-core and never declines a page
  for (const fast of ['setext heading', 'data-mdast', 'marker markdown', 'link named by its label'])
    found.delete(fast)
  const untagged = [...found].filter((why) => !PARITY.has(why) && !SECURITY.has(why))
  expect(untagged).toEqual([])
  expect([...PARITY].filter((why) => SECURITY.has(why))).toEqual([])
  expect(found.size).toBeGreaterThanOrEqual(20)
})
