---
'@affordances/md': patch
---

The converter finds the content root, empty tables and code-block titles in one walk each instead of re-walking the page per candidate, so big pages convert faster. Output is unchanged.
