---
'@affordances/md': patch
---

The line `md()` prints when it adds `.affordances/**/*.ts` to `tsconfig.json`'s `include` is now a warning that starts with the change (`Updated tsconfig.json: …`) and says to commit it, so a build changing a tracked file is hard to miss.
