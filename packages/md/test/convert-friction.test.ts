import { expect, test } from 'vitest'
import { htmlToMarkdown } from '../src/index.ts'

// vlt.io's friction report (affordances-friction.md); vlt-settings.html and vlt-package.html are the pages it's from
const md = (body: string) =>
  htmlToMarkdown(`<html><body><main>${body}</main></body></html>`, {
    url: 'https://vlt.test/p',
    frontmatter: false,
  }).markdown
const text = (markdown: string, children = '') =>
  `<affordances-md data-mode="text" style="display:contents" data-md="${markdown}">${children}</affordances-md>`

test('F-6: an <AgentText> inside a link keeps the link, and two side by side stay on one line', () => {
  expect(
    md(
      `<div><a href="/c">${text('Ann', '<span>ann</span>')}</a><a href="/d">${text('Bob')}</a></div>`,
    ),
  ).toBe('[Ann](https://vlt.test/c) [Bob](https://vlt.test/d)\n')
  expect(md(`<p>By <a href="/c">${text('**Ann**')}</a>.</p>`)).toBe(
    'By [**Ann**](https://vlt.test/c).\n',
  )
  // a block one is still its own block
  expect(
    md(
      `<div><p>a</p><affordances-md data-mode="text" data-block="" data-md="## B"></affordances-md></div>`,
    ),
  ).toBe('a\n\n## B\n')
})

test('F-7, F-14: links named by aria-label, wrapped links and text in a flex or grid gap are spaced', () => {
  expect(
    md(
      '<div><a href="/a" aria-label="Ann"><span></span></a><a href="/b" aria-label="Bob"><span></span></a></div>',
    ),
  ).toBe('[Ann](https://vlt.test/a) [Bob](https://vlt.test/b)\n')
  expect(
    md(
      '<div class="flex"><span><a href="/c" aria-label="All"><span></span></a></span><span><a href="/c" aria-label="All"><span></span></a></span><span><a href="/c">+2</a></span></div>',
    ),
  ).toBe('[All](https://vlt.test/c) [+2](https://vlt.test/c)\n')
  expect(
    md('<p><span class="inline-flex gap-1.5">and configure<span>vlt</span> to use</span></p>'),
  ).toBe('and configure vlt to use\n')
  expect(md('<p><span style="display:grid">Docs<a href="/d">here</a></span></p>')).toBe(
    'Docs [here](https://vlt.test/d)\n',
  )
  expect(md('<p class="sm:inline-flex">Run<b>vlt</b></p>')).toBe('Run **vlt**\n')
})

test('F-7, F-14: words that really are adjacent stay whole', () => {
  // not a flex or grid container: text beside an element is one run of text
  expect(md('<p>un<b>believ</b>able</p>')).toBe('un**believ**able\n')
  expect(md('<p>Wi<b>F</b>i and <span class="flex-1">foo<b>bar</b></span></p>')).toBe(
    'Wi**F**i and foo**bar**\n',
  )
  // one-character pieces are a word split for styling, in a flex container too
  expect(md('<p><span class="flex">H<span>i</span></span></p>')).toBe('Hi\n')
  // only a letter or digit meeting another is spaced: $48, 5.3.0, a closing parenthesis
  expect(md('<p><span class="inline-flex">$<span>48</span>.<span>00</span></span></p>')).toBe(
    '$48.00\n',
  )
  expect(md('<p><span class="flex">(<span>beta</span>)</span></p>')).toBe('(beta)\n')
  // code is left as written, even in a flex container
  expect(md('<pre class="flex"><code>a<span>b</span></code></pre>')).toBe('```\nab\n```\n')
  // text with a space already gets no second one
  expect(md('<p><span class="flex">Hello <b>world</b></span></p>')).toBe('Hello **world**\n')
})

test('F-9: aria toggles are fields; their state shows only on a values form, and a mirror counts once', () => {
  const switches =
    '<label for="p">Private account</label><button type="button" role="switch" aria-checked="true" id="p"><span></span></button>' +
    '<input type="checkbox" aria-hidden="true" tabindex="-1" value="on" checked>' +
    '<label for="t">Require 2FA</label><button type="button" role="switch" aria-checked="false" id="t"></button>'
  expect(md(`<form>${switches}</form>`)).toBe(
    '**Form**\n\n- Private account (switch)\n- Require 2FA (switch)\n',
  )
  // a toggle's state isn't its value: like a checkbox's, it shows even when the label sounds like a secret
  expect(md(`<form data-affordances-md="values">${switches}</form>`)).toBe(
    '**Form**\n\n- Private account (switch): on\n- Require 2FA (switch): off\n',
  )
  // a select's shown value is a value: a secret's never shows, nor a placeholder
  expect(
    md(
      '<form data-affordances-md="values"><label for="k">API key</label><button role="combobox" id="k"><span>sk_LEAK</span></button>' +
        '<label for="r">Region</label><button role="combobox" id="r" data-placeholder=""><span>Pick one</span></button></form>',
    ),
  ).toBe('**Form**\n\n- API key (select)\n- Region (select)\n')
})

test('F-10: a form is named by its aria-label, aria-labelledby or first heading, and says the rest in place', () => {
  expect(
    md('<form aria-label="Billing"><p>Hint</p><input aria-label="Card name"><p>After</p></form>'),
  ).toBe('**Billing**\n\nHint\n\n- Card name\n\nAfter\n')
  expect(
    md('<h2 id="b">Billing</h2><form aria-labelledby="b"><input aria-label="Card name"></form>'),
  ).toBe('## Billing\n\n**Billing**\n\n- Card name\n')
  expect(md('<form><h3>Billing</h3><input aria-label="Card name"></form>')).toBe(
    '### Billing\n\n- Card name\n',
  )
  // a heading after the fields doesn't name them
  expect(md('<form><input aria-label="Card name"><h3>Help</h3></form>')).toBe(
    '**Form**\n\n- Card name\n\n### Help\n',
  )
})

// a values form whose one field, Note, holds v
const value = (v: string) =>
  md(
    `<form data-affordances-md="values"><label for="x">Note</label><input id="x" name="x" value="${v}"></form>`,
  )

test("F-11: a field's value isn't escaped for gfm autolinks, and still is where markdown needs it", () => {
  expect(value('support@acme.dev')).toBe('**Form**\n\n- Note: support@acme.dev\n')
  expect(value('https://github.com/acme')).toBe('**Form**\n\n- Note: https://github.com/acme\n')
  expect(value('www.acme.dev')).toBe('**Form**\n\n- Note: www.acme.dev\n')
  expect(value('*not bold* [no](link) &lt;b&gt;')).toBe(
    '**Form**\n\n- Note: \\*not bold\\* \\[no]\\(link) \\<b>\n',
  )
})

test('F-12: a label follows aria-labelledby, its ids in order, skipping one that is missing', () => {
  expect(
    md(
      '<form data-affordances-md="values"><span id="a">Billing</span><span id="b">email</span>' +
        '<input aria-labelledby="b missing a" name="x" value="bill@acme.dev"></form>',
    ),
  ).toBe('**Form**\n\nBilling email\n\n- email Billing: bill@acme.dev\n')
})

test("F-16: a sortable column's header is its button's text", () => {
  expect(
    md(
      '<table><thead><tr><th><button>Name<svg></svg></button></th><th>Tag</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    ),
  ).toBe('| Name | Tag |\n| ---- | --- |\n| a    | b   |\n')
})
