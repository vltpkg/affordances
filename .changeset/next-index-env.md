---
'@affordances/next': patch
---

`withAffordances` sets `AFFORDANCES_INDEX` in the app's `env` to the site index's path (`INDEX_ENV` from `@affordances/next/config`), so a plugin reads it when a request comes in. `@affordances/md`'s `llms` handlers use it to find the index whether `withAffordances` or `withMd` wraps first.
