import { expect, test } from 'vitest'
import { htmlToMarkdown } from '../src/index.ts'

// blocks where markdown wants one line or one paragraph: a definition's lists, a cell's stacked boxes
const md = (body: string) =>
  htmlToMarkdown(`<html><body><main>${body}</main></body></html>`, {
    url: 'https://site.test/p',
    frontmatter: false,
  }).markdown
const cell = (content: string) =>
  md(`<table><tr><th>n</th></tr><tr><td>${content}</td></tr></table>`).split('\n')[2]

test('a list in a definition is its own block, after the term and the text before it', () => {
  expect(
    md(
      '<dl><dt>Install</dt><dd>from scratch.<ul><li>binary preinstalled</li><li>cache warm</li></ul></dd>' +
        '<dt>Run</dt><dd>five times</dd></dl>',
    ),
  ).toBe(
    '**Install**: from scratch.\n\n- binary preinstalled\n- cache warm\n\n**Run**: five times\n',
  )
  // with nothing before it, the term stands alone
  expect(md('<dl><dt>Steps</dt><dd><ol><li>one</li><li>two</li></ol></dd></dl>')).toBe(
    '**Steps**:\n\n1. one\n2. two\n',
  )
  // paragraphs stay paragraphs, the term leading the first
  expect(md('<dl><dt>A</dt><dd><p>one</p><p>two</p></dd></dl>')).toBe('**A**: one\n\ntwo\n')
  // text after a paragraph is a paragraph of its own, not glued onto the one before
  expect(md('<dl><dt>A</dt><dd><p>one</p><p>two</p>three</dd></dl>')).toBe(
    '**A**: one\n\ntwo\n\nthree\n',
  )
  expect(md('<dl><dt>A</dt><dd>lead<p>one</p>after</dd></dl>')).toBe(
    '**A**: lead\n\none\n\nafter\n',
  )
  // a definition that's a run of text is still one paragraph
  expect(md('<dl><dt>A</dt><dt>B</dt><dd>both <em>here</em></dd></dl>')).toBe(
    '**A**, **B**: both _here_\n',
  )
})

test('a field line in a definition stays on its term’s line', () => {
  expect(
    md(
      '<form data-affordances-md="values"><dl><dt><label for="s">Seats</label></dt>' +
        '<dd><input id="s" value="5"></dd></dl></form>',
    ),
  ).toBe('Seats: 5\n')
})

test('boxes stacked in a cell are spaced, whatever their text ends with', () => {
  expect(cell('<div>1,542</div><div>1,533–1,550</div>')).toBe('| 1,542 1,533–1,550 |')
  expect(cell('<p>alpha</p> <p>beta</p>')).toBe('| alpha beta |')
  expect(cell('Shirt<div>red</div>')).toBe('| Shirt red |')
  expect(
    cell('<span class="block">yarn (zpm)</span><span class="block text-xs">6.0.0-rc.20</span>'),
  ).toBe('| yarn (zpm) 6.0.0-rc.20 |')
  expect(cell('<span style="display: block">5/6</span><span>fixtures</span>')).toBe(
    '| 5/6 fixtures |',
  )
  expect(cell('<div class="flex"><span>1,542</span><span>1,533</span></div>')).toBe(
    '| 1,542 1,533 |',
  )
})

test('what is laid out as one run in a cell stays whole', () => {
  expect(cell('<span>1</span><span>2</span><span>3</span>')).toBe('| 123 |')
  expect(cell('<div class="flex"><span>$</span><span>48</span></div>')).toBe('| $48 |')
  expect(cell('un<b>believ</b>able')).toBe('| un**believ**able |')
  expect(cell('<span class="inline-block">v</span><span>2</span>')).toBe('| v2 |')
})

// an avatar as shadcn renders one in a stack: a link with its name for screen readers, and the image's fallback
const avatar = (href: string, name: string, fallback: string) =>
  `<a href="${href}"><span class="sr-only">${name}</span>${fallback}</a>`

test('links side by side are spaced when one holds an empty block, as an avatar fallback does', () => {
  for (const fallback of ['<div></div>', '<span><span><div></div></span></span>'])
    expect(
      md(
        `<div class="flex -space-x-2">${avatar('/a', 'Ann', fallback)}${avatar('/b', 'Bo', fallback)}</div>`,
      ),
    ).toBe('[Ann](https://site.test/a) [Bo](https://site.test/b)\n')
  // a block with something to read keeps the link a block
  expect(
    md('<div class="flex"><a href="/a"><h3>Ann</h3></a><a href="/b"><h3>Bo</h3></a></div>'),
  ).toBe('### [Ann](https://site.test/a)\n\n### [Bo](https://site.test/b)\n')
})

test('single characters in boxes stay one word, and a field line in a cell keeps one space', () => {
  expect(
    md(
      '<p><span class="block">1</span><span class="block">2</span><span class="block">3</span></p>',
    ),
  ).toBe('123\n')
  expect(md('<p><span style="display:flex">$</span><span>48</span></p>')).toBe('$48\n')
  expect(md('<p><span class="block">x</span>,<span class="block">y</span></p>')).toBe('x,y\n')
  expect(
    md(
      '<form data-affordances-md="values"><table><tr><th>Item</th></tr><tr><td><div><label for="q">Qty</label></div>' +
        '<div><input id="q" value="5"></div></td></tr></table></form>',
    ).split('\n')[2],
  ).toBe('| Qty: 5 |')
})

test("a link's <br> is a line break, never an empty block", () => {
  expect(md('<p><a href="/ann">Ann Lee<br>Engineer</a></p>')).toBe(
    '[Ann Lee\\\nEngineer](https://site.test/ann)\n',
  )
})
