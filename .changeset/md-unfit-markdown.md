---
'@affordances/md': patch
---

Fixed: a file named `markdown.ts` next to a page that has none of a `markdown.ts`'s exports (a helper with only a named export) broke `tsc` with a bare `TS2322` in `.affordances/md.ts`. `md()` now leaves it out and says so when the config loads. `tsc` stops with the same message: the file, what it exports, the exports a `markdown.ts` uses, and to move it out of `app/` or rename it if it's for something else.
