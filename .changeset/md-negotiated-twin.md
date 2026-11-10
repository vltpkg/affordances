---
'@affordances/md': minor
---

On a route with `publicCache`, an anonymous request for the page's own URL with `Accept: text/markdown` gets a `307` to its `.md` twin, `private, no-store`, `Vary: Accept`, with a line naming the twin. Nothing is rendered, and the twin is what a CDN keeps, so agents that negotiate hit the cache too. Credentialed requests and routes without `publicCache` are unchanged, and the redirect's `Location` is relative, so it's right behind any proxy. `llms.txt` and `llms-full.txt` now read each page at its twin (at its own URL with `Accept` on a `literalMd` route), so they follow no redirect.
