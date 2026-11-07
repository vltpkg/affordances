---
'@affordances/md': minor
---

md: `mdLink(request)` gives a proxy.ts the `Link` alternate for a page's public URL, for routes `md()`'s header rules can't match (a URL the proxy rewrites, like a scoped package's). The rewrites and `mdRewrite` also leave a request with Next's `_rsc` param alone, like one with the `RSC` header.
