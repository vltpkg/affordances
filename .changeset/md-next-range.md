---
'@affordances/md': minor
---

`@affordances/md` supports every Next 16 (`next: >=16`), and it's tested on a version matrix from 16.0.0 to the current canary. Where md reads something Next doesn't document, a Next that changes it gets private markdown or an error, never a public or wrong page:

- A page whose Flight data has any error row (a boundary that caught an error, an `error.tsx`) keeps its status and is `private, no-store` with `x-affordances-md-error`, even on a route with `publicCache` or a page Next itself cached. `llms.txt` and `llms-full.txt` leave it out, as a private page, and stay cacheable.
- A Next digest md can't read answers `502`, `private, no-store`, logged once per process. So a Next release that changes its digests shows up as 502s, never as wrong pages.
- A page the handler couldn't reach at all (a refused connection, an unreachable origin) answers `502`, not `504`, which stays for a page that took too long. The body names only the page's path, never the origin, which can be an internal host; development adds the cause, in the body and the log.
