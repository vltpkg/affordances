---
'@affordances/md': minor
---

`markdown.ts` next to a `page.tsx` gives that route's markdown from its data, without rendering the page. It returns a string, `{ markdown, title?, description? }`, a `Response`, or `undefined` to fall back to converting the HTML. `md()` finds the files, generates `.affordances/md.ts`, and aliases the new `@affordances/md/routes` export to it.

The page's own auth checks don't run for `markdown.ts`, and `proxy.ts` runs only once, on the requested URL, so `markdown.ts` must use fetchers the API authorizes. **If you used 0.1.0's proxy recipe, which returned early for markdown requests (`if (isMdRequest(request)) return NextResponse.next()`), remove that skip, or move it after your auth gate, before adding a `markdown.ts`.** Otherwise nothing gates it. The handler never runs `markdown.ts` for a request made straight to its own URL, or for a URL Next wouldn't route to the page (another letter case, percent-encoded or empty segments). `llms.txt` and `llms-full.txt` fetch each page at its public URL with `Accept: text/markdown`, as an anonymous visitor.
