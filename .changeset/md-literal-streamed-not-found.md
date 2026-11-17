---
'@affordances/md': patch
---

On a `literalMd` route, a page that streams `notFound()` after its shell (a `200` with the not-found page) now counts as a 404, so a request for `x.md` gets the twin, as a Markdown request already did. One that streams `forbidden()` or `unauthorized()` answers its `403` or `401`, `private, no-store`. To tell, the handler reads a `200` HTML page before passing it on, up to `maxBytes` and within the `timeout`. It then sends the page's own bytes, status and headers.
