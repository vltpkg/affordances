---
'@affordances/md': minor
---

`llms-full.txt` is never cached missing a page. A page that failed to render (a timeout, the `deadline`, a `5xx`, `408` or `429`, a fetch error, or a page still loading after its `timeout`) makes it a `503` with `Cache-Control: no-store` and `Retry-After`, so the next request renders it again. `llms.txt` still links such a page by its path and stays cacheable. `x-affordances-md-dropped` now counts failed pages only. A page left out by design (a redirect, another `4xx`, a response that isn't Markdown, a private render) leaves the file cacheable, and in development a private one is logged as an error.

`createLlmsTxtHandler` and `createLlmsFullHandler` take `publicCache`, with `markdown.ts`'s values (a `cacheLife` profile or `{ revalidate, expire? }`) or `false`. The default is still an hour.
