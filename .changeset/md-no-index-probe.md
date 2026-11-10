---
'@affordances/md': patch
---

Without the Affordances graph (`withMd` on its own), `llms.txt` and `llms-full.txt` no longer ask for `/.well-known/affordances.json`: `md()` knows there's no site index.
