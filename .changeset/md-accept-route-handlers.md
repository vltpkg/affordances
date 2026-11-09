---
'@affordances/md': patch
---

A route handler outside `app/api/` (`/llms.txt`, `/openapi.json`, `/og/[slug]`, or a Next metadata route such as `sitemap.ts`), asked for with `Accept: text/markdown`, is passed through as it is, with the caller's own headers, rather than fetched as a page to convert. `md()` records each one when it scans `app/` and ranks them with its pages as Next does, so a static page beside a dynamic route handler (`/og/about` beside `app/og/[slug]/route.ts`) is still a page, and a route handler's path is never twinned in a link.
