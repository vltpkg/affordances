---
'@affordances/md': minor
---

`md({ aliases })` maps public URL shapes your `proxy.ts` or rewrites send to an `app/` route, in Next's rewrite syntax: `{ '/package/@:scope/:name/:rest*': '/package/@:scope%2F:name/:rest*' }`. Those URLs then get their `Link` header, twin links in the Markdown, and their route's `markdown.ts`, with `params` exactly as `page.tsx` gets them (`{ pkg: '%40babel%2Fcore' }`, still encoded). `literalMd` stays in public URL space: list an aliased URL's public shape there. Each alias is checked when the config loads: a destination no page answers throws, quoting the alias and naming the nearest pages. Aliases match as strictly as Next routes a page, against the URL that was requested, and a request made straight to the handler still never runs a `markdown.ts`.
