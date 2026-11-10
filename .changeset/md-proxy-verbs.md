---
'@affordances/md': minor
---

`mdProxy` gains three verbs and `@affordances/md/next/proxy` gains a function:

- `md.request`: the page as a `NextRequest`, with the request's method, headers and cookies, for a gate that takes a request.
- `md.rewrite(destination, init?)`: `NextResponse.rewrite`'s signature. A Markdown request gets the destination page's Markdown with `init.status`, `private, no-store`, varying on `Accept`; anything else gets Next's own rewrite.
- `md.adopt(response)`: makes a third-party middleware's answer right for a Markdown request. Its redirect to a page on this site goes to that page's `.md`, its rewrite gives that page's Markdown with its status, and its `next()` goes on to the handler, with the cookies it set. Another origin, and any request that isn't for Markdown, get the response as it came.
- `mdAliasPath(pathname)`: the app route URL a public URL renders through `md({ aliases })`, as the handler resolves it.

The gate's own request headers (the ones it sets with `request.headers`, such as who the visitor is) reach the page's `markdown.ts`, fills and `append` in place of the client's, and a rewrite keeps its destination's query. A rewrite's page and status reach the handler on a request header carrying a token from `md()`, new on each build and kept in no file, which the route takes off the request before your code sees it. A header without it answers `500`, never the page unguarded, and a proxy without the token answers `500` rather than rewriting unverified.
