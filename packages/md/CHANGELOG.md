# @affordances/md

## 0.3.0

### Minor Changes

- 89a26fd: `md({ aliases })` maps public URL shapes your `proxy.ts` or rewrites send to an `app/` route, in Next's rewrite syntax: `{ '/package/@:scope/:name/:rest*': '/package/@:scope%2F:name/:rest*' }`. Those URLs then get their `Link` header, twin links in the Markdown, and their route's `markdown.ts`, with `params` exactly as `page.tsx` gets them (`{ pkg: '%40babel%2Fcore' }`, still encoded). `literalMd` stays in public URL space: list an aliased URL's public shape there. Each alias is checked when the config loads: a destination no page answers throws, quoting the alias and naming the nearest pages. Aliases match as strictly as Next routes a page, against the URL that was requested, and a request made straight to the handler still never runs a `markdown.ts`.
- b5415c2: `mdProxy(request)` from `@affordances/md/next/proxy` gives a gated `proxy.ts` one object: `md.page`, the page the request is for whether it asks for HTML or Markdown (`/compare.md` is `/compare`), so every gate runs on the same URL; `md.markdown`; `md.redirect(url, status?)`, which sends a Markdown request to the target's `.md` when it's on this site (privately, varying on `Accept`) and any other target as a plain redirect; `md.next(init?)`, which sends a Markdown request to the handler and lets any other through; and `md.link`. The docs' gate-first recipe is now three lines around it. `isMdRequest`, `mdRewrite` and `mdLink` are unchanged.
- adaef12: `markdown.ts` can export `slots`, which fill the page's `<AgentSlot name>`s instead of replacing the whole page: `export const slots = { readme: async ({ params }) => … } satisfies Slots<'/package/[pkg]'>`. The default export still runs first, and anything but `undefined` is the whole page. Otherwise the page renders (so its redirects, `notFound()` and layout checks run before any fill), then only the slots it rendered once, where they reach the Markdown, run, together and in the visitor's request; the rest converts as usual. A slot's own render condition doesn't gate its fill (user HTML can carry a marker), so each fill authorizes its own data, as `markdown.ts` does. A filled page is `private, no-store`, a fill's `notFound()` or `redirect()` answers for the whole page, and a request straight to the handler runs no fill. In development the handler warns, naming the route's `markdown.ts`, about a fill with no slot, a slot with no fill, a name used twice, and a fill that returned nothing.
- ba82656: Slots and links in markers:

  - `<AgentSlot name>` marks a part of the page that `markdown.ts` fills, while the rest of the page converts from its HTML. A name rendered twice is filled nowhere.
  - `readPage(html)` reads a page once: its `slots` lists the page's slots, `markdown(slots)` fills them, and `redirect` is a `redirect()` Next streamed into it. `htmlToMarkdown(html, { slots })` does it in one call.
  - Links in `<AgentText md>` and in a slot's fill are made absolute and pointed at their Markdown twin, like the page's links.

  Fixed: a block `<AgentText>` inside a paragraph ran into the paragraph's text, which was broken Markdown. It's now its own block between the paragraph's halves.

- 5166b33: `MarkdownArgs<'/route'>`, `Markdown<'/route'>` and `Slots<'/route'>` type `params` from the route string, as `PageProps` does for `page.tsx`: `[x]` is a `string`, `[...x]` a `string[]`, `[[...x]]` a `string[]` or left out. `params` stays a plain object, still URL-encoded, and without a route the types are 0.2.0's. The arguments also carry `route`, the `app/` route the handler matched (`'/package/[pkg]'`); it's optional in the type, so arguments built by hand, as in a 0.2.0 unit test, still type-check. The generated `.affordances/md.ts` checks each `markdown.ts` against its own route, so a wrong route string fails `tsc`, even one whose params look the same; TypeScript skips `.affordances/` unless `include` names it, so `md()` adds `".affordances/**/*.ts"` to `tsconfig.json`'s `include`, as Next adds `.next/types`: only that array, keeping comments and formatting, and only when the file has its own `include` without it. When it can't edit safely (the file can't be read or parsed, `include` is inherited, or the file is read-only), it warns with the line to add, and never stops the config from loading.

  A `markdown.ts` can use Next's own `notFound()`, `forbidden()`, `unauthorized()`, `redirect()` and `permanentRedirect()`: they answer `404`, `403`, `401`, or a `307`/`308`: to the target's `.md` when it's a page on this site, and to the target as it is otherwise (another origin, an API route, a route handler or a file), all `private, no-store`.

### Patch Changes

- 6c275d2: Converter fixes:

  - An `<AgentText>` inside a link keeps the link.
  - Links named only by `aria-label`, links in wrappers and text in a flex or grid gap are spaced.
  - Sortable table headers keep their button's label.
  - Forms read ARIA switches, checkboxes, radios, toggles and selects, follow `aria-labelledby`, are named by their `aria-label`, `aria-labelledby` or first heading, keep their text in page order, and no longer escape `@` and `:` in values.
  - A form's tables and definition lists keep their shape, with each field written where it is. A form named by its own `<legend>` or `<label>` keeps that name as its title.
  - Fields and links are named as a screen reader names them: a switch, checkbox, radio or toggle button by its own words, and a link with nothing in it by its `aria-labelledby`.
  - A heading, caption, summary or term whose only text is a button (an accordion's header) reads the button's text.
  - A name never reads what's hidden from people or what carries a value (a textarea, an option, an output, meter or progress, an editor), and an editor (`contenteditable`, `role="textbox"`) is left out like a textarea.

- 150da63: A page that calls `redirect()` after its shell has streamed now gives a 307 (or 308 for `permanentRedirect()`) to the target's `.md`, instead of a 200 with only the shell. The handler reads the redirect Next streams into the page, and applies the same rules as for any other redirect: same-origin targets become their `.md`, another origin is passed on as it came, and a credentialed or negotiated response is `private, no-store`.

  An RSC request that also asks for Markdown, and any page or file the handler passes through, no longer 500s when the app's `proxy.ts` rewrote the page: the handler drops Next's `x-middleware-*` headers, which a route handler can't send.

## 0.2.0

### Minor Changes

- 302afce: md: a form marked `data-affordances-md="values"` lists its fields' current values, never a hidden, password, or secret-looking field's. The converter also drops skeleton tables (no cell text, or a header over empty rows), merges a run of the same link into one, and spaces inline elements laid out side by side with CSS gaps (`express 5.3.0`).
- c07e88e: `md({ literalMd })` takes routes whose pages' own URLs can end in `.md`. There the handler fetches the exact URL first: the page wins if it answers with anything but a 404 (converted for a Markdown request, passed through as HTML otherwise), and a 404 makes the `.md` the twin suffix. Twin URLs are unchanged.
- 88e486b: `markdown.ts` next to a `page.tsx` gives that route's markdown from its data, without rendering the page. It returns a string, `{ markdown, title?, description? }`, a `Response`, or `undefined` to fall back to converting the HTML. `md()` finds the files, generates `.affordances/md.ts`, and aliases the new `@affordances/md/routes` export to it.

  The page's own auth checks don't run for `markdown.ts`, and `proxy.ts` runs only once, on the requested URL, so `markdown.ts` must use fetchers the API authorizes. **If you used 0.1.0's proxy recipe, which returned early for markdown requests (`if (isMdRequest(request)) return NextResponse.next()`), remove that skip, or move it after your auth gate, before adding a `markdown.ts`.** Otherwise nothing gates it. The handler never runs `markdown.ts` for a request made straight to its own URL, or for a URL Next wouldn't route to the page (another letter case, percent-encoded or empty segments). `llms.txt` and `llms-full.txt` fetch each page at its public URL with `Accept: text/markdown`, as an anonymous visitor.

- bfe7523: New `@affordances/md/next/proxy` entry with `mdRewrite`, `mdLink`, `isMdRequest`, `mdPagePath` and the rule constants, for a `proxy.ts`. It holds only the matching, so a proxy that imports it bundles neither the converter nor any `markdown.ts`. `@affordances/md/next` re-exports the same functions, so existing imports keep working.
- c07e88e: md: `mdLink(request)` gives a proxy.ts the `Link` alternate for a page's public URL, for routes `md()`'s header rules can't match (a URL the proxy rewrites, like a scoped package's). The rewrites and `mdRewrite` also leave a request with Next's `_rsc` param alone, like one with the `RSC` header.
- 302afce: md: a page still streaming at the handler's `timeout` is converted as far as it got, not answered with a 504. Unresolved boundaries keep their fallback, the markdown ends with a note, and the response is `private, no-store` with `x-affordances-md-partial: 1`. Streamed content also resolves past ten boundaries (React's ids are hex), into table rows, and through React's `$RR`, `$RS` and external-runtime reveal forms.

  The `headers` option's `cookie` and `authorization` now apply only to a request that sent neither: a signed-in person's markdown renders with their own credentials alone, never as the service account, and an anonymous request still renders with the service's. A visitor with any cookie, even an unrelated one (analytics, consent), is rendered without the option's credentials: on a protected preview whose access rides on them, that visitor's markdown may be the protection or login page. A bypass in its own header, such as `x-vercel-protection-bypass`, always applies, so use one of those for protection bypass. Both are `private, no-store`.

- 302afce: The handler's markdown links the site's own pages to their markdown twins (`/blog/post` → `/blog/post.md`, query and hash kept), so an agent following a link stays in markdown. Opt out with `createMdHandler({ linkTwins: false })`. `htmlToMarkdown` takes the hook as a new `link` option.

### Patch Changes

- 4d1a09b: Converter hardening from the security audit: a page's own `data-affordances-md-text` is no longer output verbatim; links keep only their text unless they're `http`, `https`, `mailto`, or `tel` (checked as a browser parses them, so `java&#10;script:` is caught), and images need `http` or `https`; content hidden with an inline `display: none` or `visibility: hidden` is dropped; a field's placeholder or `name` is never its label; and `usePageMarkdown` refuses a path on another origin.
- 4d1a09b: md: a form's label or legend no longer carries the value of a control inside it. A `<label>` wrapping a `<textarea>` gave its text (`Key sk-…`), and one wrapping a `<select>` gave every option.
- 302afce: On a `literalMd` route, a link in the handler's markdown to a page whose own URL ends in `.md` points at that page's twin (`/x/readme.md` → `/x/readme.md.md`), like any page's, instead of being left as the HTML page.
- c07e88e: The markdown handler passes a client navigation (`RSC` header) through as the page's own RSC response instead of converting it, so a `proxy.ts` using `mdRewrite` no longer turns an RSC fetch that asks for `text/markdown` into markdown.

## 0.1.0

### Minor Changes

- 3ec29dd: First release: protocol v0, defineAction/defineState and the handler, the Next.js adapter, WebMCP provider and dev overlay, the MCP bridge, lint rules, @affordances/md (any page as markdown at the same url), and the affordances CLI.
