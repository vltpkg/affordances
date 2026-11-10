---
'@affordances/md': minor
---

`markdown.ts` can export `notFoundMarkdown`, the route's 404 in Markdown. It runs whenever the route's page answered `404` through `notFound()`, before or after the shell streamed, so an agent gets the same body either way, with the default export's arguments. It returns a string, `{ markdown, title?, description? }`, or `undefined` for the page's own `not-found.tsx` as before. The answer is always `404`, `private, no-store`, and a request straight to the handler's URL never runs it. Typed as `NotFoundMarkdown<'/route'>`.
