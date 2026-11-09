import { expect, test } from 'vitest'
import { htmlToMarkdown } from '../src/index.ts'

// /code-review and /simplify findings on md-0.3.0: forms, names and label hosts
const md = (body: string) =>
  htmlToMarkdown(`<html><body><main>${body}</main></body></html>`, {
    url: 'https://vlt.test/p',
    frontmatter: false,
  }).markdown

test('A13: a table in a form keeps its shape, with each field written where it is', () => {
  expect(
    md(
      '<form><table><thead><tr><th>Product</th><th>Price</th><th>Qty</th></tr></thead><tbody>' +
        '<tr><td>Shirt</td><td>$10</td><td><label>Quantity <input name="qty" value="1"></label></td></tr>' +
        '<tr><td>Hat</td><td>$5</td><td><label>Quantity <input name="qty2" value="2"></label></td></tr>' +
        '</tbody></table><button>Update</button></form>',
    ),
  ).toBe(
    '**Form**\n\n| Product | Price | Qty      |\n| ------- | ----- | -------- |\n| Shirt   | $10   | Quantity |\n| Hat     | $5    | Quantity |\n',
  )
  // so does a definition list, and a values form shows the value in place
  expect(
    md(
      '<form data-affordances-md="values"><dl><dt>Plan</dt><dd>Pro</dd><dt>Seats</dt>' +
        '<dd><input aria-label="Seats" value="5"></dd></dl><label for="n">Name</label><input id="n" value="Acme"></form>',
    ),
  ).toBe('**Form**\n\n**Plan**: Pro\n\n**Seats**: Seats: 5\n\n- Name: Acme\n')
  // what holds no field converts as usual around the lines
  expect(
    md(
      '<form><p>Update your <em>shipping</em> details.</p><div><label>Name <input name="n"></label><p>As on your card.</p></div></form>',
    ),
  ).toBe('**Form**\n\nUpdate your _shipping_ details.\n\n- Name\n\nAs on your card.\n')
})

test('A14: a form named by its own legend or label keeps that name as its title', () => {
  expect(
    md(
      '<form aria-labelledby="lg"><fieldset><legend id="lg">Shipping address</legend>' +
        '<label>Street <input name="street"></label><label>City <input name="city"></label></fieldset></form>',
    ),
  ).toBe('**Shipping address**\n\n- Street\n- City\n')
  expect(
    md(
      '<form aria-labelledby="t"><label id="t">Newsletter</label><input aria-labelledby="t" name="email"></form>',
    ),
  ).toBe('**Newsletter**\n\n- Newsletter\n')
  // a heading that names it says it in place, so there's no title
  expect(
    md(
      '<form aria-labelledby="h"><h2 id="h">Sign up</h2><label>Email <input name="e"></label></form>',
    ),
  ).toBe('## Sign up\n\n- Email\n')
})

test('A16: controls and links named by their content or aria-labelledby', () => {
  // a switch named by its content
  expect(
    md(
      '<form data-affordances-md="values"><button role="switch" aria-checked="true">Wi-Fi</button></form>',
    ),
  ).toBe('**Form**\n\n- Wi-Fi (switch): on\n')
  // a toggle group: a radiogroup of buttons named by their content
  expect(
    md(
      '<form data-affordances-md="values"><div role="radiogroup" aria-label="Align">' +
        '<button role="radio" aria-checked="true">Left</button><button role="radio" aria-checked="false">Right</button></div></form>',
    ),
  ).toBe('**Form**\n\n- Align: Left (selected), Right\n')
  // a link with nothing in it, named by aria-labelledby
  expect(
    md('<p><span id="n">Ann</span> <a href="/u/ann" aria-labelledby="n"><span></span></a></p>'),
  ).toBe('Ann [Ann](https://vlt.test/u/ann)\n')
  // a link's own content still comes first
  expect(
    md('<p><a href="/u/ann" aria-labelledby="n">ann</a><span id="n" hidden>Ann</span></p>'),
  ).toBe('[ann](https://vlt.test/u/ann)\n')
  // a combobox's content is its value, never its name, and a name never carries a value
  expect(
    md(
      '<form data-affordances-md="values"><button role="combobox">dk_live_LEAK</button>' +
        '<button role="switch" aria-checked="false">Notify <input value="LEAK2"></button></form>',
    ),
  ).toBe('**Form**\n\n- Notify (switch): off\n')
})

test('A17: a heading or caption whose text is a button reads the button’s text', () => {
  expect(
    md('<h3><button aria-expanded="false">Shipping</button></h3><p>We ship worldwide.</p>'),
  ).toBe('### Shipping\n\nWe ship worldwide.\n')
  expect(
    md(
      '<details><summary><button>More</button></summary><p>Hidden</p></details><dl><dt><button>Term</button></dt><dd>Def</dd></dl>',
    ),
  ).toContain('**Term**: Def')
  // with text of its own, a button in it is still a control
  expect(md('<h2>Readme <button>Copy</button></h2>')).toBe('## Readme\n')
  // and buttons elsewhere stay dropped
  expect(md('<p>Hi <button>Close</button></p>')).toBe('Hi\n')
})

// what a name can't reach: each target is hidden from people, or carries a value
const HIDDEN_TARGETS = [
  ['display: none', '<span id="h" style="display:none">LEAK-dn</span>'],
  ['hidden', '<span id="h" hidden>LEAK-hid</span>'],
  ['aria-hidden', '<span id="h" aria-hidden="true">LEAK-ah</span>'],
  ['AgentSkip', '<affordances-md data-mode="skip"><span id="h">LEAK-skip</span></affordances-md>'],
  ['visibility: hidden', '<div style="visibility:hidden"><span id="h">LEAK-vis</span></div>'],
  ['noscript', '<noscript><span id="h">LEAK-nos</span></noscript>'],
  [
    'AgentText',
    '<affordances-md data-mode="text" data-md="shown"><span id="h">LEAK-text</span></affordances-md>',
  ],
]

test('an aria-labelledby that names something hidden from people names nothing', () => {
  for (const [, target] of HIDDEN_TARGETS) {
    // an icon link has no other name, so it's dropped as before
    expect(md(`${target}<p><a href="/x" aria-labelledby="h"><svg></svg></a></p>`)).not.toMatch(
      /LEAK|\]\(/,
    )
    // a field and a form fall back to their other names, or have none
    expect(
      md(
        `${target}<form data-affordances-md="values" aria-labelledby="h"><input aria-labelledby="h" aria-label="Plan" value="Pro"></form>`,
      ),
    ).not.toContain('LEAK')
  }
})

test('a field labelled by a textarea, select or input doesn’t carry its value out', () => {
  expect(
    md('<form><textarea id="t">LEAK-ta</textarea><input aria-labelledby="t" name="x"></form>'),
  ).not.toContain('LEAK')
  expect(
    md(
      '<form><select id="s"><option selected>LEAK-sel</option></select><input id="i" value="LEAK-in">' +
        '<output id="o">LEAK-out</output><input aria-labelledby="s i o" aria-label="Kept" name="x"></form>',
    ),
  ).toBe('**Form**\n\n- Kept\n')
})

test('A13: a definition list whose terms are a form’s labels writes each line on its own', () => {
  expect(
    md(
      '<form data-affordances-md="values"><dl><dt><label for="s">Seats</label></dt><dd><input id="s" value="5"></dd>' +
        '<dt><label for="p">Password</label></dt><dd><input id="p" type="password" value="LEAK-pw"></dd></dl></form>',
    ),
  ).toBe('**Form**\n\nSeats: 5\n\nPassword (password)\n')
  // a term with words of its own keeps them
  expect(md('<dl><dt></dt><dd>Alone</dd><dt>Term</dt><dd>Def</dd></dl>')).toBe(
    'Alone\n\n**Term**: Def\n',
  )
})

// what carries a value: its text is never a name, whichever way something is named
const VALUE_TARGETS = [
  '<textarea id="t">LEAK-ta</textarea>',
  '<select><option id="t" selected>LEAK-opt</option></select>',
  '<output id="t">LEAK-out</output>',
  '<div id="t" contenteditable="true">LEAK-ce</div>',
  '<div id="t" role="textbox">LEAK-tb</div>',
  '<meter id="t" value="0.5">LEAK-meter</meter>',
  '<progress id="t" value="5" max="10">LEAK-progress</progress>',
  '<span id="t">Name <span contenteditable="true">LEAK-nested</span></span>',
]

test('no name reads a value-bearing control: not by aria-labelledby, a label, or content', () => {
  for (const t of VALUE_TARGETS) {
    const named = [
      `<form><input aria-labelledby="t" name="q"></form>`,
      `<form aria-labelledby="t"><label for="a">A</label><input id="a"></form>`,
      `<p><a href="/x" aria-labelledby="t"><svg></svg></a></p>`,
      `<form data-affordances-md="values"><button role="switch" aria-checked="true" aria-labelledby="t"></button></form>`,
    ]
    // a meter's or output's own text is still page content; only what naming adds counts
    const page = (body: string) => md(`${t}${body}`).match(/LEAK/g)?.length ?? 0
    for (const body of named) expect(page(body)).toBe(page(body.replace('"t"', '"none"')))
    for (const host of [
      (c: string) => `<form><label for="q">${c}</label><input id="q" name="q"></form>`,
      (c: string) => `<p><a href="/x">${c}</a></p>`,
      (c: string) => `<h3><button aria-expanded="false">${c}</button></h3>`,
      (c: string) => `<table><tr><th><button>${c}</button></th></tr><tr><td>1</td></tr></table>`,
    ])
      expect(md(host(t))).not.toContain('LEAK')
  }
})

test('an editor is a field: what someone typed in it never reaches the markdown', () => {
  expect(
    md(
      '<p>Before</p><div contenteditable="true">LEAK-draft</div><div role="textbox">LEAK-typed</div><p>After</p>',
    ),
  ).toBe('Before\n\nAfter\n')
  // contenteditable="false" isn't an editor
  expect(md('<div contenteditable="false">Shown</div>')).toBe('Shown\n')
})
