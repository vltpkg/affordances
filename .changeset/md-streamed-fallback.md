---
'@affordances/md': patch
---

Fixed: a `notFound()`, `forbidden()` or `unauthorized()` that runs after a page's shell has streamed (or, with `cacheComponents`, anywhere under a `<Suspense>`) converted as a `200` with the shell's markdown. The handler now answers `404`, `403` or `401`, `private, no-store`, as it does for one thrown in `markdown.ts`. `readPage(html).fallback` gives the status.
