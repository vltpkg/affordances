---
'@affordances/md': patch
---

On a `literalMd` route, a link in the handler's markdown to a page whose own URL ends in `.md` points at that page's twin (`/x/readme.md` → `/x/readme.md.md`), like any page's, instead of being left as the HTML page.
