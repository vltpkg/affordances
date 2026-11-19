---
'@affordances/next': patch
---

Fix TypeScript error TS2307 for `@standard-schema/spec` under strict installs or `skipLibCheck: false`. `@affordances/next`'s types now reference only `@affordances/core`, and are otherwise unchanged.
