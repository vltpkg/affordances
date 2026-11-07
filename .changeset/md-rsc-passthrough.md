---
'@affordances/md': patch
---

The markdown handler passes a client navigation (`RSC` header) through as the page's own RSC response instead of converting it, so a `proxy.ts` using `mdRewrite` no longer turns an RSC fetch that asks for `text/markdown` into markdown.
