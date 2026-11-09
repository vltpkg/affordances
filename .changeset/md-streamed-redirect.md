---
'@affordances/md': patch
---

A page that calls `redirect()` after its shell has streamed now gives a 307 (or 308 for `permanentRedirect()`) to the target's `.md`, instead of a 200 with only the shell. The handler reads the redirect Next streams into the page, and applies the same rules as for any other redirect: same-origin targets become their `.md`, another origin is passed on as it came, and a credentialed or negotiated response is `private, no-store`.

An RSC request that also asks for Markdown, and any page or file the handler passes through, no longer 500s when the app's `proxy.ts` rewrote the page: the handler drops Next's `x-middleware-*` headers, which a route handler can't send.
