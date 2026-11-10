import { expect, test } from 'vitest'
import { htmlToMarkdown } from '../src/index.ts'

// patterns from component libraries (shadcn, Radix, data tables) and real pages; fixtures/settings-form.html and
// fixtures/package-page.html are whole pages built from them
const md = (body: string) =>
  htmlToMarkdown(`<html><body><main>${body}</main></body></html>`, {
    url: 'https://example.test/p',
    frontmatter: false,
  }).markdown
const text = (markdown: string, children = '') =>
  `<affordances-md data-mode="text" style="display:contents" data-md="${markdown}">${children}</affordances-md>`

test('an <AgentText> inside a link keeps the link, and two side by side stay on one line', () => {
  expect(
    md(
      `<div><a href="/c">${text('Ann', '<span>ann</span>')}</a><a href="/d">${text('Bob')}</a></div>`,
    ),
  ).toBe('[Ann](https://example.test/c) [Bob](https://example.test/d)\n')
  expect(md(`<p>By <a href="/c">${text('**Ann**')}</a>.</p>`)).toBe(
    'By [**Ann**](https://example.test/c).\n',
  )
  // a block one is still its own block
  expect(
    md(
      `<div><p>a</p><affordances-md data-mode="text" data-block="" data-md="## B"></affordances-md></div>`,
    ),
  ).toBe('a\n\n## B\n')
})

test('links named by aria-label, wrapped links and text in a flex or grid gap are spaced', () => {
  expect(
    md(
      '<div><a href="/a" aria-label="Ann"><span></span></a><a href="/b" aria-label="Bob"><span></span></a></div>',
    ),
  ).toBe('[Ann](https://example.test/a) [Bob](https://example.test/b)\n')
  expect(
    md(
      '<div class="flex"><span><a href="/c" aria-label="All"><span></span></a></span><span><a href="/c" aria-label="All"><span></span></a></span><span><a href="/c">+2</a></span></div>',
    ),
  ).toBe('[All](https://example.test/c) [+2](https://example.test/c)\n')
  expect(
    md('<p><span class="inline-flex gap-1.5">and configure<span>vlt</span> to use</span></p>'),
  ).toBe('and configure vlt to use\n')
  expect(md('<p><span style="display:grid">Docs<a href="/d">here</a></span></p>')).toBe(
    'Docs [here](https://example.test/d)\n',
  )
  expect(md('<p class="sm:inline-flex">Run<b>vlt</b></p>')).toBe('Run **vlt**\n')
})

test('words that really are adjacent stay whole', () => {
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

test('aria toggles are fields; their state shows only on a values form, and a mirror counts once', () => {
  const switches =
    '<label for="p">Private account</label><button type="button" role="switch" aria-checked="true" id="p"><span></span></button>' +
    '<input type="checkbox" aria-hidden="true" tabindex="-1" value="on" checked>' +
    '<label for="t">Require 2FA</label><button type="button" role="switch" aria-checked="false" id="t"></button>'
  expect(md(`<form>${switches}</form>`)).toBe(
    '- Private account (switch)\n- Require 2FA (switch)\n',
  )
  // a toggle's state isn't its value: like a checkbox's, it shows even when the label sounds like a secret
  expect(md(`<form data-affordances-md="values">${switches}</form>`)).toBe(
    '- Private account (switch): on\n- Require 2FA (switch): off\n',
  )
  // a select's shown value is a value: a secret's never shows, nor a placeholder
  expect(
    md(
      '<form data-affordances-md="values"><label for="k">API key</label><button role="combobox" id="k"><span>sk_LEAK</span></button>' +
        '<label for="r">Region</label><button role="combobox" id="r" data-placeholder=""><span>Pick one</span></button></form>',
    ),
  ).toBe('- API key (select)\n- Region (select)\n')
})

test('on a values form a checkbox, switch, toggle or lone radio gives its state as on, off or mixed', () => {
  const toggles =
    '<label><input type="checkbox" checked> Keep logs</label><label><input type="checkbox"> Notify</label>' +
    '<button type="button" role="checkbox" aria-checked="mixed" aria-label="All"></button>' +
    '<button type="button" role="switch" aria-checked="true" aria-label="Enabled"></button>' +
    '<label><input type="radio" checked> Only one</label>'
  expect(md(`<form data-affordances-md="values">${toggles}</form>`)).toBe(
    '- Keep logs (checkbox): on\n- Notify (checkbox): off\n- All (checkbox): mixed\n- Enabled (switch): on\n' +
      '- Only one (radio): on\n',
  )
  // without values, none has a state; a group's choice is the page's, so it shows either way
  expect(md(`<form>${toggles}</form>`)).toBe(
    '- Keep logs (checkbox)\n- Notify (checkbox)\n- All (checkbox)\n- Enabled (switch)\n- Only one (radio)\n',
  )
  expect(
    md(
      '<form><label><input type="radio" name="p" checked> Free</label><label><input type="radio" name="p"> Pro</label></form>',
    ),
  ).toBe('- Free (selected), Pro\n')
})

test('a form is named by its aria-label or aria-labelledby, and says the rest in place', () => {
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
    '- Card name\n\n### Help\n',
  )
  // without a name there's no title line, and its first text isn't taken for one: a card's title says it in place
  expect(
    md(
      '<form data-affordances-md="values"><div data-slot="card-title">Private Account</div>' +
        '<button type="button" role="switch" aria-checked="true" aria-label="Enabled"></button></form>',
    ),
  ).toBe('Private Account\n\n- Enabled (switch): on\n')
  expect(md('<form><input aria-label="Email"></form>')).toBe('- Email\n')
})

// a values form whose one field, Note, holds v
const value = (v: string) =>
  md(
    `<form data-affordances-md="values"><label for="x">Note</label><input id="x" name="x" value="${v}"></form>`,
  )

test("text isn't escaped for gfm autolinks, outside a heading, and still is where markdown needs it", () => {
  expect(value('support@acme.dev')).toBe('- Note: support@acme.dev\n')
  expect(value('https://github.com/acme')).toBe('- Note: https://github.com/acme\n')
  expect(value('www.acme.dev')).toBe('- Note: www.acme.dev\n')
  expect(value('*not bold* [no](link) &lt;b&gt;')).toBe(
    '- Note: \\*not bold\\* \\[no]\\(link) \\<b>\n',
  )
  // an email, a url or www. in text would be a link to itself, which reads the same
  expect(md('<p>Mail tj@acme.dev, see www.acme.dev or https://acme.dev</p>')).toBe(
    'Mail tj@acme.dev, see www.acme.dev or https://acme.dev\n',
  )
  expect(md('<table><tr><th>Email</th></tr><tr><td>tj@acme.dev</td></tr></table>')).toBe(
    '| Email       |\n| ----------- |\n| tj@acme.dev |\n',
  )
  // a heading keeps them: a url shown as itself isn't part of a page's title
  expect(md('<h1>Mail tj@acme.dev</h1>')).toBe('# Mail tj\\@acme.dev\n')
})

test('a label follows aria-labelledby, its ids in order, skipping one that is missing', () => {
  expect(
    md(
      '<form data-affordances-md="values"><span id="a">Billing</span><span id="b">email</span>' +
        '<input aria-labelledby="b missing a" name="x" value="bill@acme.dev"></form>',
    ),
  ).toBe('Billing email\n\n- email Billing: bill@acme.dev\n')
})

test("a sortable column's header is its button's text", () => {
  expect(
    md(
      '<table><thead><tr><th><button>Name<svg></svg></button></th><th>Tag</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    ),
  ).toBe('| Name | Tag |\n| ---- | --- |\n| a    | b   |\n')
})

test("a highlighter's code block keeps its language and title from where the highlighter put them", () => {
  const code = '<code><span class="line">ls</span></code>'
  expect(md(`<pre data-language="sh">${code}</pre>`)).toBe('```sh\nls\n```\n')
  expect(md(`<pre><code data-language="sh">ls</code></pre>`)).toBe('```sh\nls\n```\n')
  expect(md(`<pre class="language-sh">${code}</pre>`)).toBe('```sh\nls\n```\n')
  // a language-* class on the code wins, and a language is one word
  expect(md(`<pre data-language="js"><code class="language-sh">ls</code></pre>`)).toBe(
    '```sh\nls\n```\n',
  )
  expect(md(`<pre data-language="sh x">${code}</pre>`)).toBe('```sh\nls\n```\n')
  // a title before the code in its figure, or on what holds it, is the fence's, and isn't said again
  expect(
    md(
      `<figure><div><figcaption>run.sh</figcaption></div><pre data-language="sh">${code}</pre></figure>`,
    ),
  ).toBe('```sh title="run.sh"\nls\n```\n')
  expect(md(`<div data-title="run.sh"><pre data-language="sh">${code}</pre></div>`)).toBe(
    '```sh title="run.sh"\nls\n```\n',
  )
  // a caption after the code is a caption; a figure with two blocks has no one title; nor a block with no language
  expect(
    md(
      `<figure><pre data-language="sh">${code}</pre><figcaption>Lists files</figcaption></figure>`,
    ),
  ).toBe('```sh\nls\n```\n\nLists files\n')
  expect(
    md(
      `<figure><figcaption>Both</figcaption><pre data-language="sh">${code}</pre><pre data-language="sh">${code}</pre></figure>`,
    ),
  ).toBe('Both\n\n```sh\nls\n```\n\n```sh\nls\n```\n')
  expect(md(`<figure><figcaption>run.sh</figcaption><pre>${code}</pre></figure>`)).toBe(
    'run.sh\n\n```\nls\n```\n',
  )
})
