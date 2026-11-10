# code-*.html: how they were captured

One code block, rendered by each highlighter as it ships, inside
`<html><head><title>Code</title></head><body><main>…</main></body></html>`:

````md
```ts title="app/route.ts"
export const GET = () =>
  Response.json({ ok: true, at: '<now>' })
```
````

- `code-shiki.html`: shiki 4.6.0, `codeToHtml(code, { lang: 'ts', theme: 'github-dark' })`. Shiki takes no title,
  and its output says no language.
- `code-rehype-pretty-code.html`: rehype-pretty-code 0.14.6 after remark-parse and remark-rehype, `{ theme: 'github-dark' }`.
- `code-expressive-code.html`: rehype-expressive-code 0.44.3 the same way, `{ themes: ['github-dark'] }`.
- `code-fumadocs.html`: fumadocs-core 16.17.9's `rehypeCode` with its defaults, then fumadocs-ui 16.18.4's `mdx`
  components (its `CodeBlock` for `pre`) through hast-util-to-jsx-runtime and `renderToStaticMarkup` (React 19.3.1).
  Its output says no language.
- `code-fumadocs-language-class.html`: the same with `rehypeCode`'s `addLanguageClass: true`.
