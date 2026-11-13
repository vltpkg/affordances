---
'@affordances/md': patch
---

Converts about 5× faster; the markdown is unchanged. Malformed HTML, and a few unusual placements (a slot or AgentMain inside a link, a shown panel under a hidden one, or a header or nav inside a link on a page with no `<main>`), can convert slightly slower.
