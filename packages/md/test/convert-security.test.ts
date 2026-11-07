import { expect, test } from 'vitest'
import { htmlToMarkdown } from '../src/index.ts'

const md = (body: string) =>
  htmlToMarkdown(`<html><body><main>${body}</main></body></html>`, {
    url: 'https://shop.test/page',
    frontmatter: false,
  }).markdown

test("a page's own data-affordances-md-text is text, not verbatim markdown", () => {
  const out = md(
    '<p><span data-affordances-md-text="<img src=x onerror=alert(1)>[pwn](https://evil.test)">Hello</span></p>' +
      '<div data-affordances-md-text="<script>x</script>">World</div>',
  )
  expect(out).toBe('Hello\n\nWorld\n')
})

test('links to anything but http, https, mailto and tel keep only their text', () => {
  const hrefs = [
    'javascript:alert(1)',
    'java&#10;script:alert(1)',
    'java&#9;script:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]
  for (const href of hrefs) expect(md(`<p><a href="${href}">click</a></p>`)).toBe('click\n')
  expect(md('<p><a href="mailto:a@shop.test">mail</a> <a href="tel:+15550100">call</a></p>')).toBe(
    '[mail](mailto:a@shop.test) [call](tel:+15550100)\n',
  )
  expect(md('<p><a href="/tees">tees</a></p>')).toBe('[tees](https://shop.test/tees)\n')
})

test('images from anything but http and https are left out', () => {
  for (const src of ['javascript:alert(1)', 'java&#10;script:x', 'data:image/png;base64,AAAA'])
    expect(md(`<p>a</p><img src="${src}" alt="Tee">`)).toBe('a\n')
  expect(md('<img src="/tee.png" alt="Tee">')).toBe('![Tee](https://shop.test/tee.png)\n')
})

test('content hidden with an inline style is left out, unless it was marked for agents', () => {
  const out = md(
    '<p>Shown</p>' +
      '<p style="display:none">None</p>' +
      '<p style="color: red; DISPLAY : none !important">Important</p>' +
      '<div style="visibility:hidden"><p>Invisible</p></div>' +
      '<p style="visibility: collapse">Collapsed</p>' +
      '<p style="display:block">Block</p>' +
      '<affordances-md data-mode="only" hidden style="display:none"><p>For agents</p></affordances-md>',
  )
  expect(out).toBe('Shown\n\nBlock\n\nFor agents\n')
})

test('placeholders and names never become labels, and a group without a legend has no name', () => {
  const out = md(
    '<form>' +
      '<input name="secret_question" placeholder="Your mother\'s maiden name">' +
      '<input name="coupon">' +
      '<input aria-label="Email" name="email" placeholder="you@example.com">' +
      '<input type="radio" name="internal_size_v2" value="M"><input type="radio" name="internal_size_v2" value="L">' +
      '<fieldset aria-label="Color"><input type="radio" name="c" id="r"><label for="r">Red</label></fieldset>' +
      '</form>',
  )
  expect(out).toBe('**Form**\n\n- Email\n- Color: Red\n')
})

test('a choice without a label is left out, so its value never shows', () => {
  const out = md(
    '<form>' +
      '<input type="radio" name="acct" value="acct_internal_9f8e" checked>' +
      '<label><input type="radio" name="acct" value="acct_public_1"> Public</label>' +
      '<fieldset><legend>Hidden</legend><input type="checkbox" name="x" value="x_internal_2"></fieldset>' +
      '</form>',
  )
  expect(out).toBe('**Form**\n\n- Public\n')
})

test('inline-style hiding is read the way css reads it: comments, escapes, spaced !important, content-visibility', () => {
  const out = md(
    '<p>Shown</p>' +
      '<p style="display:none ! important">Spaced</p>' +
      '<p style="display:/**/none">Comment</p>' +
      '<p style="display:/* a; b */none">Semicolon comment</p>' +
      '<p style="display:n\\one">Escape</p>' +
      '<p style="display:\\6e one">Hex escape</p>' +
      '<p style="vis\\ibility:hidden">Property escape</p>' +
      '<p style="content-visibility:hidden">Content visibility</p>' +
      // opacity: 0 is an entrance animation's first frame, not hidden
      '<p style="opacity:0">Fading in</p>' +
      '<p style="content-visibility:auto">Auto</p>',
  )
  expect(out).toBe('Shown\n\nFading in\n\nAuto\n')
})

test('a css escape past the last code point, a surrogate or zero reads as U+FFFD, never an error', () => {
  const out = md(
    '<p style="color:\\110000">Past</p>' +
      '<p style="color:\\d800">Surrogate</p>' +
      '<p style="color:\\0">Zero</p>' +
      '<p style="display:\\ffffff">Max</p>',
  )
  expect(out).toBe('Past\n\nSurrogate\n\nZero\n\nMax\n')
})

const page = (body: string) =>
  htmlToMarkdown(`<html><body>${body}</body></html>`, { frontmatter: false }).markdown

test("a real <main> is the page's body, before any [role=main] and around any nested main", () => {
  expect(page('<div role="main"><p>Spoof</p></div><main><p>Real</p></main>')).toBe('Real\n')
  expect(page('<main><p>Real</p><article><main><p>Nested</p></main></article></main>')).toBe(
    'Real\n\nNested\n',
  )
  expect(page('<nav>Menu</nav><div role="main"><p>Role</p></div>')).toBe('Role\n')
  // a comment's <main> inside the page's role=main landmark is part of it, never the page
  expect(
    page(
      '<div role="main"><p>Page</p><div class="comment"><main><p>Attacker</p></main></div></div>',
    ),
  ).toBe('Page\n\nAttacker\n')
})

test('invalid JSON-LD stays inside its fence', () => {
  const out = htmlToMarkdown(
    '<html><head><script type="application/ld+json">{"a": "x\n```\n# Injected\n````"</script></head><body><main><p>Hi</p></main></body></html>',
    { frontmatter: false },
  ).markdown
  expect(out).toBe('Hi\n\n`````json\n{"a": "x\n```\n# Injected\n````"\n`````\n')
})

const canonical = (head: string, body = '') =>
  htmlToMarkdown(`<html><head>${head}</head><body>${body}<main><p>Hi</p></main></body></html>`, {
    url: 'https://shop.test/page',
  }).url

test("the canonical is the <head>'s, an http(s) url that can't break the Link header", () => {
  expect(canonical('<link rel="canonical" href="/tees">')).toBe('https://shop.test/tees')
  expect(canonical('', '<link rel="canonical" href="https://evil.test/x">')).toBe(
    'https://shop.test/page',
  )
  for (const href of [
    'https://shop.test/a>; rel="preload", <https://evil.test',
    'https://shop.test/a,b',
    'https://shop.test/a;b',
    'javascript:alert(1)',
  ])
    expect(canonical(`<link rel="canonical" href='${href}'>`)).toBe('https://shop.test/page')
  // <, > and whitespace are percent-encoded, so they're safe
  expect(canonical('<link rel="canonical" href="https://shop.test/a b<c">')).toBe(
    'https://shop.test/a%20b%3Cc',
  )
})
