---
'@affordances/md': minor
---

`md()` no longer edits `tsconfig.json` when the config loads. When `.affordances/**/*.ts` isn't in its `include`, `md()` says the line to add, once per process. `affordances-md init` adds it, keeping the file's comments and formatting. `markdown.ts` works either way; the include is what lets `tsc` and `next build` check each one against its route. Development warnings that fired on every request (a cookie set on an opted-in page, a default export that returned nothing, a slot without a fill) are now said once per route per process. The `maxBytes` warning is said once per page.
