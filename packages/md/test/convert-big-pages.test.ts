import { expect, test } from 'vitest'
import { htmlToMarkdown, readPage } from '../src/index.ts'

// what a big page costs to read: next's flight data is dropped before parsing, the head is read in one walk, and a
// filled slot's own children aren't converted. none of it may change what the markdown says
const md = (html: string, slots?: Record<string, string>) =>
  htmlToMarkdown(html, { frontmatter: false, slots }).markdown
const push = (payload: string) => `<script>self.__next_f.push([1,"${payload}"])</script>`
const flight = [
  '<script>(self.__next_f=self.__next_f||[]).push([0])</script>',
  push('1:\\"$Sreact.fragment\\"\\n2:I[9556,[],\\"\\"]'),
  // the flight copy of a reveal, an error fallback and the page's own text: its quotes are escaped, so none of it is one
  push('3:[\\"$\\",\\"p\\",null,{\\"children\\":\\"$RC(\\\\\\"B:0\\\\\\",\\\\\\"S:0\\\\\\")\\"}]'),
  push('4:E{\\"digest\\":\\"NEXT_HTTP_ERROR_FALLBACK;404\\"}'),
  '<script nonce="abc">self.__next_f.push([1,"5:null"])</script>',
].join('')
// what's around the flight data goes in the page's main, after its streamed boundary
const streamed = (around = '') =>
  `<html><head><title>T</title></head><body><main><!--$?--><template id="B:0"></template><p>Loading</p><!--/$-->${around}</main>` +
  `${flight}<div hidden id="S:0"><p>Streamed in</p></div><script>$RC("B:0","S:0")</script></body></html>`

test('flight data is never content, and the reveals after it still apply', () => {
  expect(md(streamed())).toBe('# T\n\nStreamed in\n')
  expect(readPage(streamed()).fallback).toBeUndefined()
  // as it reads with no flight data at all
  expect(md(streamed())).toBe(md(streamed().replace(flight, '')))
})

test('what looks like flight data but isn’t a script is read as the page has it', () => {
  // a quoted > in a script's open tag: the tag runs to the closing quote, so the push is the attribute's value, and
  // what follows it is the script's own text, never the page's
  for (const opened of [
    '<script a="x>self.__next_f.push([1,"x"])</script>"><p>LEAK-dq</p></script>',
    '<script a=\'x>self.__next_f.push([1,"x"])</script>\'><p>LEAK-sq</p></script>',
    '<script data-x=">self.__next_f.push([1,"x"])</script>"><div>LEAK-dq2</div></script>',
  ])
    expect(md(streamed(opened))).toBe(md(streamed()))
  // inside an attribute: taking it out would drop the hidden attribute after it, so the page is parsed as sent
  const attribute = `<div title="<script>self.__next_f.push([1," hidden data-x="])</script>"><p>LEAK-hidden</p></div>`
  expect(md(streamed(attribute))).not.toContain('LEAK')
  // inside a comment that ends inside it: what comes after the comment is the page's text
  const comment = '<!-- <script>self.__next_f.push([1," --> Shown after "])</script> -->'
  expect(md(streamed(comment))).toContain('Shown after')
  // inside a textarea, which a field's value never leaves
  const textarea = `<textarea><script>self.__next_f.push([1,"LEAK-typed"])</script></textarea>`
  expect(md(streamed(textarea))).not.toContain('LEAK')
  // a page can't forge a swap: the marker's value is new for every page
  const forged = '<script data-affordances-flight="x"></script>'
  expect(md(streamed(forged + attribute))).not.toContain('LEAK')
})

test('the head is read as before, whatever order its tags come in', () => {
  const page = readPage(
    '<html lang="fr"><head><meta property="og:title" content="OG"><link rel="canonical" href="https://site.test/c">' +
      '<meta name="description" content="About"><meta property="og:image" content="https://site.test/i.png">' +
      '<script type="application/ld+json">{"@type":"Thing"}</script></head>' +
      '<body><svg><title>Icon</title></svg><title>Body title</title><link rel="canonical" href="https://evil.test/">' +
      '<main><p>x</p></main></body></html>',
    { url: 'https://site.test/p' },
  )
  const { markdown } = page.markdown()
  expect(markdown).toContain('title: "Body title"')
  expect(markdown).toContain('url: "https://site.test/c"')
  expect(markdown).toContain('description: "About"')
  expect(markdown).toContain('image: "https://site.test/i.png"')
  expect(markdown).toContain('lang: "fr"')
  expect(markdown).toContain('"@type": "Thing"')
})

const slot = (rows: number) =>
  `<affordances-md data-mode="slot" style="display:contents" data-name="table"><table><tr><th>n</th></tr>${'<tr><td>row</td></tr>'.repeat(rows)}</table></affordances-md>`
test('a filled slot’s children are left out, and the page can be converted again', () => {
  const page = readPage(`<html><body><main><h1>Results</h1>${slot(3)}</main></body></html>`, {
    frontmatter: false,
  })
  expect(page.markdown({ table: '| n |\n|---|\n| 1 |' }).markdown).toBe(
    '# Results\n\n| n |\n|---|\n| 1 |\n',
  )
  expect(page.markdown().markdown).toContain('| row |')
  // and a big fallback costs nothing once it's filled
  const big = readPage(`<html><body><main><h1>Results</h1>${slot(20000)}</main></body></html>`, {
    frontmatter: false,
  })
  const started = performance.now()
  expect(big.markdown({ table: 'Filled' }).markdown).toBe('# Results\n\nFilled\n')
  // generous for a loaded machine: converting the fallback instead takes seconds
  expect(performance.now() - started).toBeLessThan(1500)
})
