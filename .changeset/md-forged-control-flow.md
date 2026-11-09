---
'@affordances/md': patch
---

Security: in 0.3.0, a page's own content could redirect its `.md`. A raw copy of Next's redirect tag (`<meta id="__next-page-redirect" http-equiv="refresh">`) in content a page renders as HTML (a README, a user's post) made the handler answer a redirect, to another origin too. Now only the error row Next writes into the page's Flight data counts, which a page's content can't write. The same rule decides the status of a streamed `notFound()`, `forbidden()` or `unauthorized()`.
