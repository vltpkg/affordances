---
'@affordances/md': patch
---

Documented: the default export and every fill of one twin get the same `request` object, so a `WeakMap` keyed by it shares their data, and it's tested. `caching.mdx` notes that Next sets an app page's own `Vary`, replacing one from `next.config`, `proxy.ts` or `md()`.
