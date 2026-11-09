---
'@affordances/md': patch
---

Fixed: relative links in `createLlmsTxtHandler`'s `intro` were printed as written, so they broke for an agent reading `llms.txt` away from the site. They're now absolute and point at their twins, as page links are.
