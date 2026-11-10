import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { htmlToMarkdown } from '../src/index.ts'

const dir = new URL('./fixtures/', import.meta.url)
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.html'))

// golden files: fixtures/<name>.html → fixtures/<name>.md (vitest -u rewrites them; review the diff)
test.each(fixtures)('%s', async (file) => {
  const html = readFileSync(new URL(file, dir), 'utf8')
  const { markdown } = htmlToMarkdown(html, { url: 'https://shop.test/page' })
  await expect(markdown).toMatchFileSnapshot(`fixtures/${file.replace(/\.html$/, '.md')}`)
})

// a labelled text field named name, holding VALUE-name
const field = (name: string) =>
  `<label for="${name}">${name} field</label><input id="${name}" name="${name}" value="VALUE-${name}">`

test("an opted-in form never shows a value whose field's name says it's a secret, and still shows the rest", () => {
  const secrets = [
    'cvv',
    'cvc',
    'card_cvc',
    'ssn',
    'userSSN',
    'pin',
    'user-pin',
    'pin_code',
    'private_key',
    'privateKey',
    'stripe_signing_key',
    'signingKey',
    'authorization',
    'cookie',
    'sid',
    'session_sid',
    'signature',
    'webhookSignature',
    'webhook_secret',
    'auth_token',
    'authtoken',
    'accessToken',
    'passwd',
    'new_password',
    'otp',
    'csrf',
    'api_key',
    'apikey',
    'card_number',
    'cardNumber',
    'one-time-code',
    // a trailing digit, as in a payment form's cvv2
    'cvv2',
    'cvc2',
    'password2',
    'token2',
    'pin1',
    'api_key2',
    'apiKey1',
    'otp6',
    'ssn4',
    'password_2',
    // synonyms
    'pwd',
    'passcode',
    'passphrase',
    'totp',
    'mfa_code',
    'securityCode',
    'social_security_number',
    'jwt',
    'card_num',
    'ccnum',
    'credit_card',
    // and what was already hidden
    'refreshToken',
    'secretKey',
    'clientSecret',
    'session_token',
    'x-api-key',
    'APIKEY',
    'PASSWORD',
    'SSN',
    'cc_num',
    'cc-exp',
  ]
  const plain = [
    'side',
    'inside',
    'pinned',
    'spinner',
    'opinion',
    'tokenizer',
    'shipping',
    'pinterest_url',
    'passage',
    'accent',
    'cc',
    'cc_email',
    'security_policy',
    'card_type',
    'h264',
  ]
  const { markdown } = htmlToMarkdown(
    `<main><form data-affordances-md="values">${[...secrets, ...plain].map(field).join('')}</form></main>`,
  )
  for (const name of secrets)
    expect({ name, shown: new RegExp(`VALUE-${name}(?![\\w-])`).test(markdown) }).toEqual({
      name,
      shown: false,
    })
  for (const name of plain) expect(markdown).toContain(`${name} field: VALUE-${name}`)
  // autocomplete names it too
  const card = htmlToMarkdown(
    '<main><form data-affordances-md="values"><label for="c">Card</label><input id="c" name="c" autocomplete="cc-number" value="4242"></form></main>',
  )
  expect(card.markdown).not.toContain('4242')
})

test("an opted-in form never shows a value whose label, aria-label or placeholder says it's a secret", () => {
  const said = [
    '<label>API key <input name="k" value="LEAK-1"></label>',
    '<label for="s">Session ID</label><input id="s" name="a" value="LEAK-2">',
    '<input aria-label="Recovery phrase" name="b" value="LEAK-3">',
    '<input placeholder="Seed words" name="c" value="LEAK-4">',
    '<label>Your mnemonic <input name="d" value="LEAK-5"></label>',
    '<label>Bearer <input name="e" value="LEAK-6"></label>',
    '<label>Credentials <input name="f" value="LEAK-7"></label>',
    '<label>IBAN <input name="g" value="LEAK-8"></label>',
    '<label>Account number <input name="h" value="LEAK-9"></label>',
    '<label>Routing number <input name="i" value="LEAK-10"></label>',
    '<label>Passwort <input name="j" value="LEAK-11"></label>',
    '<label>Kennwort <input name="l" value="LEAK-12"></label>',
    '<label>Contraseña <input name="m" value="LEAK-13"></label>',
    '<label>Mot de passe <input name="n" value="LEAK-14"></label>',
    '<input name="deploy_key" aria-label="Deploy" value="LEAK-15">',
  ]
  const shown = [
    '<label>Pinned repo <input name="o" value="SHOWN-1"></label>',
    '<label>Tokenizer <input name="p" value="SHOWN-2"></label>',
    '<label>Cc <input name="q" value="SHOWN-3"></label>',
    '<label>Keyboard layout <input name="r" value="SHOWN-4"></label>',
  ]
  const { markdown } = htmlToMarkdown(
    `<main><form data-affordances-md="values">${[...said, ...shown].join('')}</form></main>`,
  )
  expect(markdown).not.toMatch(/LEAK-/)
  for (const i of [1, 2, 3, 4]) expect(markdown).toContain(`SHOWN-${i}`)
})

// a field whose label wraps it, holding VALUE-i
const labelled = (label: string, i: number, value = `VALUE-${i}`) =>
  `<label>${label} <input name="f${i}" value="${value}"></label>`

test('a secret is told apart from a field that only shares a word with one', () => {
  const hidden = [
    'Database URL',
    'DSN',
    'Webhook URL',
    'Verification code',
    '2FA code',
    'Backup codes',
    'PW',
    'Pass',
    'Security answer',
    'Wachtwoord',
    'Senha',
    'Contraseña',
    'Şifre',
    'Hasło',
    'Пароль',
    '密码',
    'パスワード',
    '비밀번호',
    'كلمة المرور',
    'License key',
    'Access key',
    'Recovery code',
    'Session token',
    'Token value',
    'OTP code',
    // a version is a number too
    'pin_v2',
    'token_v3',
    'OTP v1',
    // any key but a few that aren't secrets, and a session
    'service_role_key',
    'serviceRoleKey',
    'Server key',
    'write_key',
    'consumer_key',
    'admin_key',
    'shared_key',
    'root_key',
    'merchant_key',
    'Key',
    'Session',
    'session_id',
    'PIN',
    'PIN code',
  ]
  const shown = [
    'Pin to top',
    'Session title',
    'Key features',
    'Primary key column',
    'Token name',
    'Musical key',
    'Public key',
    'foreign_key',
    'sort_key',
    'partition_key',
    'Keyboard layout',
    'Hotkey',
    'Recovery email',
    'OTP enabled',
    'Login ID',
    'Passage',
  ]
  const { markdown } = htmlToMarkdown(
    `<main><form data-affordances-md="values">${[
      ...hidden.map((label, i) => labelled(label, i)),
      ...shown.map((label, i) => labelled(label, i + 100)),
      // a url with a user and password is a secret whatever its field says
      labelled('Endpoint', 200, 'postgres://app:hunter2@db.internal:5432/prod'),
      labelled('Homepage', 201, 'https://shop.test/about'),
      // and so is a bearer token, or a jwt
      labelled('Header', 202, 'Bearer hunter3'),
      labelled('Assertion', 203, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.hunter4'),
      labelled('Greeting', 204, 'Bear with us'),
    ].join('')}</form></main>`,
  )
  for (const [i, label] of hidden.entries())
    expect({ label, shown: markdown.includes(`VALUE-${i}\n`) }).toEqual({ label, shown: false })
  for (const [i, label] of shown.entries()) expect(markdown).toContain(`${label}: VALUE-${i + 100}`)
  expect(markdown).not.toMatch(/hunter[234]/)
  expect(markdown).toContain('Homepage: https://shop.test/about')
  expect(markdown).toContain('Greeting: Bear with us')
})

test('never outputs values, tokens, scripts, comments, or data attributes', () => {
  const all = fixtures
    .map((f) => htmlToMarkdown(readFileSync(new URL(f, dir), 'utf8')).markdown)
    .join('\n')
  for (const secret of [
    // form-labels: a label or legend wrapping a control never carries its value
    'sk-LIVE-SECRET-wrapped',
    'for-label-private-note',
    'United States',
    'label-wrapped@example.com',
    'label-output-value',
    'legend-output-value',
    'tok_9f8a7b6c',
    'hunter2',
    'jane@example.com',
    'SAVE20',
    'private note',
    'window.secret',
    'deploy 42',
    'data-tracking',
    'onclick',
    'color: red',
    // form-values: an opted-in form still never gives a hidden field, a password, or a secret-looking field
    'tok_settings_csrf_1',
    'pw-s3cret-value',
    'key-live-0123456789',
    '845221',
    'UPPER-PW-LEAK',
    'HIDDEN-LEAK',
    '4111111111111111',
    // settings-form: a select whose label says it's a secret
    'dk_live_LEAK',
  ])
    expect(all).not.toContain(secret)
})

// streamed-react19.html is a real next start capture; streamed-react19.capture.md says how to capture it again
test('streamed content replaces every fallback, except a boundary the server left to the client', () => {
  const { markdown } = htmlToMarkdown(readFileSync(new URL('streamed-react19.html', dir), 'utf8'))
  expect(markdown).toContain('Size 8XL available')
  expect(markdown).toContain('| Bone  | 5     |')
  expect(markdown).toContain('Five stars from Ada.')
  expect(markdown.match(/Loading[^\n]*/g)).toEqual(['Loading recommendations…'])
  // the dehydrated queries ride in the flight data, never in the markdown
  expect(markdown).not.toContain('rq-dehydrated-payload')
  expect(markdown).not.toContain('queryKey')
})

test('is deterministic, and counts tokens', () => {
  const html = readFileSync(new URL('article.html', dir), 'utf8')
  const a = htmlToMarkdown(html)
  expect(htmlToMarkdown(html)).toEqual(a)
  expect(a.title).toBe('Shipping notes')
  expect(a.tokens).toBe(Math.ceil(a.markdown.length / 4))
})

test('the link option rewrites absolute link urls, never images or a #fragment of the page', () => {
  const html = `<main><h1>Hi</h1><p><a href="/docs?x=1#y">Docs</a> <a href="#top">Top</a> <a href="https://other.test/a">Other</a>
    <img src="/docs.png" alt="Docs shot"> <a href="/keep">Keep</a></p></main>`
  const seen: string[] = []
  const { markdown } = htmlToMarkdown(html, {
    url: 'https://shop.test/page',
    link: (url) => {
      seen.push(url.href)
      return url.pathname === '/keep'
        ? undefined
        : `${url.origin}${url.pathname}.md${url.search}${url.hash}`
    },
  })
  expect(seen).toEqual([
    'https://shop.test/docs?x=1#y',
    'https://other.test/a',
    'https://shop.test/keep',
  ])
  expect(markdown).toContain('[Docs](https://shop.test/docs.md?x=1#y)')
  expect(markdown).toContain('[Top](https://shop.test/page#top)')
  expect(markdown).toContain('[Other](https://other.test/a.md)')
  expect(markdown).toContain('![Docs shot](https://shop.test/docs.png)')
  expect(markdown).toContain('[Keep](https://shop.test/keep)')

  // a definition is a link's or an image's, by what references it: a custom handler's image by reference stays an image
  const referenced = htmlToMarkdown(
    '<main><h1>Hi</h1><figure><img src="/chart.png" alt="Chart"></figure><p><a href="/docs">Docs</a></p></main>',
    {
      url: 'https://shop.test/page',
      link: (url) => `${url.href}.md`,
      handlers: {
        figure: () =>
          [
            {
              type: 'imageReference',
              identifier: 'chart',
              label: 'chart',
              referenceType: 'full',
              alt: 'Chart',
            },
            { type: 'definition', identifier: 'chart', label: 'chart', url: '/chart.png' },
            { type: 'definition', identifier: 'guide', label: 'guide', url: '/guide' },
          ] as never,
      },
    },
  ).markdown
  expect(referenced).toMatch(/^\[chart\]: https:\/\/shop\.test\/chart\.png$/m)
  expect(referenced).toMatch(/^\[guide\]: https:\/\/shop\.test\/guide\.md$/m)
})

test('options: no frontmatter, no JSON-LD, extract none, custom handlers', () => {
  const html = readFileSync(new URL('article.html', dir), 'utf8')
  const plain = htmlToMarkdown(html, { frontmatter: false, jsonLd: false }).markdown
  expect(plain.startsWith('# Shipping notes')).toBe(true)
  expect(plain).not.toContain('schema.org')
  expect(htmlToMarkdown(html, { extract: 'none' }).markdown).toContain('© 2026 Afford Supply')
  const custom = htmlToMarkdown(html, {
    handlers: { blockquote: () => ({ type: 'text', value: 'QUOTE' }) as never },
  })
  expect(custom.markdown).toContain('QUOTE')
})

test('a label wrapping a control never carries its value, even on a form that opts in to values', () => {
  const { markdown } = htmlToMarkdown(
    `<main><form data-affordances-md="values">
      <label>Key <textarea name="api_key">sk-OPTIN-SECRET</textarea></label>
      <label>Region <select name="region"><option>United States</option><option selected>Europe</option></select></label>
    </form></main>`,
  )
  expect(markdown).not.toContain('sk-OPTIN-SECRET')
  expect(markdown).not.toContain('United States')
  expect(markdown).toContain('- Key (textarea)\n- Region (select)')
})

// a page with this <title> and h1, converted
const titled = (said: string, h1: string) =>
  htmlToMarkdown(
    `<html><head><title>${said}</title></head><body><main><h1>${h1}</h1><p>Body</p></main></body></html>`,
    { url: 'https://shop.test/page' },
  )

test("the title is the page's h1 when the <title> is the h1 in the site's template, and the <title> otherwise", () => {
  // the h1 on either side of a separator, however it's spaced
  for (const shape of [
    'Authentication — Acme Docs',
    'Acme Docs | Authentication',
    'Authentication\n  ·  Acme',
  ])
    expect(titled(shape, 'Authentication').markdown).toBe(
      '---\ntitle: "Authentication"\nurl: "https://shop.test/page"\n---\n\n# Authentication\n\nBody\n',
    )
  expect(titled('Cart - Acme', 'Cart').title).toBe('Cart')
  // an h1 that isn't the <title>'s name leaves it as it is: a headline isn't the page's name
  expect(titled('Benchmarks for 2026', 'Next is 3x faster').title).toBe('Benchmarks for 2026')
  // nor is a subtitle, a word with a hyphen in it, or the h1 as part of a longer name
  expect(titled('Cart: details', 'Cart').title).toBe('Cart: details')
  expect(titled('Sign-in · Acme', 'Sign').title).toBe('Sign-in · Acme')
  expect(titled('Cart items · Acme', 'Cart').title).toBe('Cart items · Acme')
})

// a page whose meta description is "Sign  in with a token.", with this content under its h1, converted
const described = (body: string, frontmatter = true) =>
  htmlToMarkdown(
    `<html><head><title>Auth</title><meta name="description" content="Sign  in with a token."></head>` +
      `<body><main><h1>Auth</h1>${body}</main></body></html>`,
    { url: 'https://shop.test/page', frontmatter },
  ).markdown

test('the paragraph right after the h1 goes when it says the description the frontmatter already has', () => {
  const head =
    '---\ntitle: "Auth"\ndescription: "Sign  in with a token."\nurl: "https://shop.test/page"\n---\n\n'
  expect(described('<p>Sign in <em>with</em> a\n token.</p><p>Body</p>')).toBe(
    `${head}# Auth\n\nBody\n`,
  )
  // anything else stays: other text, the same text later on, or no frontmatter to say it
  expect(described('<p>Sign in with a token, or a key.</p>')).toBe(
    `${head}# Auth\n\nSign in with a token, or a key.\n`,
  )
  expect(described('<p>Intro</p><p>Sign in with a token.</p>')).toBe(
    `${head}# Auth\n\nIntro\n\nSign in with a token.\n`,
  )
  expect(described('<p>Sign in with a token.</p>', false)).toBe('# Auth\n\nSign in with a token.\n')
})
