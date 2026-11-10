---
'@affordances/md': patch
---

Without the Affordances graph (`withMd` on its own), `llms.txt` and `llms-full.txt` no longer ask for `/.well-known/affordances.json`: only an app `withAffordances` wraps has one, whichever wrapper runs first.
