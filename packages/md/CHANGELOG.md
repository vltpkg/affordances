# @affordances/md

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
