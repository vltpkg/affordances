---
'@affordances/md': patch
---

Files in `public/` never get a Markdown twin. Under a root catch-all page, a link to `/openapi.json` stays as it is instead of pointing at `/openapi.json.md`, and no `public/` file gets a `Link` to a twin: a path has a `Link` exactly when it has a twin. A page named like a `public/` folder (`/docs/intro` beside `public/docs/`, or `/docs/v1.2` beside its images) keeps both. md() records `public/`'s files when the config loads, symlinked folders included, with a folder of thousands of files as one entry that keeps their extensions, so the list it passes to the handlers stays small.
