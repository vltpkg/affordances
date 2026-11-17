import { afterEach, expect, test } from 'vitest'
import { forcePath } from '../../../src/convert/path.ts'
import { readPage } from '../../../src/index.ts'
import { onBoth } from './support/paths.ts'

afterEach(() => forcePath(undefined))

const at = {
  url: 'https://example.test/page',
  link: (url: URL) => `${url.origin}${url.pathname}.md`,
}
// a page's markdown on both paths, md-core's in strict mode, with fills if given
const both = (html: string, fills?: Record<string, string>) =>
  onBoth(() => readPage(html, at).markdown(fills).markdown, 'strict')

const values = (fields: string) => `<form data-affordances-md="values">${fields}</form>`
test.each([
  [
    'values, and what a secret looks like',
    values(
      '<label>Plan <input name="plan" value="Pro"></label><label>API key <input name="k" value="LEAK"></label><input type="password" aria-label="Pw" value="LEAK"><input aria-label="Token" name="access_token" value="LEAK"><input aria-label="Pin to top" name="pin_to_top" value="shown"><input aria-label="Url" value="postgres://u:LEAK@h/db">',
    ),
  ],
  [
    'secrets by autocomplete, as a list of tokens',
    values(
      '<input aria-label="Card" autocomplete="cc-number section-a" value="LEAK"><input aria-label="Nick" autocomplete="nickname" value="kept">',
    ),
  ],
  [
    'toggles and choices',
    values(
      '<button role="switch" aria-checked="true">Wi-Fi</button><button aria-pressed="mixed">Bold</button><input type="checkbox" checked aria-label="Logs"><fieldset><legend>Size</legend><input type="radio" name="s" id="m" checked><label for="m">M</label><input type="radio" name="s" id="l" disabled><label for="l">L</label></fieldset>',
    ),
  ],
  [
    'selects and textareas',
    values(
      '<label>One <select><option>a</option><option selected>b</option></select></label><label>Many <select multiple><option>x</option></select></label><label>Notes <textarea>  some   text </textarea></label><button role="combobox">Picked</button><button role="combobox" data-placeholder>Choose</button>',
    ),
  ],
  [
    'without values, none show',
    '<form><label>Email <input value="LEAK"></label><input type="hidden" name="csrf" value="LEAK"></form>',
  ],
])('fields: %s', (_, html) => {
  const { core, tree } = both(html)
  expect(core).toBe(tree)
})

test.each([
  [
    'aria-labelledby inside and outside the form',
    '<p id="out">Billing</p><form aria-labelledby="out"><span id="in">Email</span><input aria-labelledby="in out" name="e"></form>',
  ],
  [
    'a label for two ids names neither',
    '<form><label for="a b">Both</label><input id="a"><input id="b" aria-label="B"></form>',
  ],
  [
    'names never carry a value out',
    '<form><textarea id="t">LEAK</textarea><input aria-labelledby="t" name="x"></form><form><select id="s"><option selected>LEAK</option></select><input aria-labelledby="s" aria-label="Kept"></form>',
  ],
  [
    'a name in something hidden names nothing',
    '<span id="h" hidden>LEAK</span><form aria-labelledby="h"><input aria-labelledby="h" aria-label="Plan"></form>',
  ],
  [
    'an id outside the main names nothing',
    '<p id="x">Outside</p><main><form><input aria-labelledby="x" name="n"></form></main>',
  ],
  [
    'placeholders and names are never labels',
    '<form><input placeholder="Email" name="email"><input name="color" aria-label="Color" value="Red"></form>',
  ],
])('names: %s', (_, html) => {
  const { core, tree } = both(html)
  expect(core).toBe(tree)
})

test.each([
  [
    'a table keeps its shape',
    '<form><table><tr><th>Product</th><th>Qty</th></tr><tr><td>Tee</td><td><input aria-label="Qty" value="2"></td></tr></table></form>',
  ],
  [
    'a definition list',
    '<form data-affordances-md="values"><dl><dt><label for="s">Seats</label></dt><dd><input id="s" value="5"></dd></dl></form>',
  ],
  [
    'prose around fields, with links and images',
    '<form><h2>Sign up</h2><p>Read <a href="/terms">the terms</a> <img src="/i.png" alt="logo"></p><input aria-label="Email"><p>Hint</p><input aria-label="Name"></form>',
  ],
  // (a form in a table cell is the tree pipeline's: recovery.test.ts)
  ['in a list item', '<ul><li><form><input aria-label="A"></form></li></ul>'],
  ['no fields says what it says', '<form><p>Just text</p><button>Go</button></form>'],
  // in the whitespace it's in: a <nobr> doesn't wrap
  ['in a nobr', '<nobr><form><mark>text\r\n</mark><input aria-label="A"> t  u </form></nobr>'],
])('shape: %s', (_, html) => {
  const { core, tree } = both(html)
  expect(core).toBe(tree)
})

const slot = (name: string) =>
  `<affordances-md data-mode="slot" data-name="${name}"><p>Loading</p></affordances-md>`
test('markers in a form: an AgentText, a filled slot and one without a fill', () => {
  const html = `<form><affordances-md data-mode="text" data-md="**[Help](/help)**"></affordances-md>${slot('a')}${slot('b')}<input aria-label="Email"></form>`
  const { core, tree } = both(html, { a: '- [x](/x)' })
  expect(core).toBe(tree)
})
