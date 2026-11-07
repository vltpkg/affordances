---
'@affordances/md': minor
---

New `@affordances/md/next/proxy` entry with `mdRewrite`, `mdLink`, `isMdRequest`, `mdPagePath` and the rule constants, for a `proxy.ts`. It holds only the matching, so a proxy that imports it bundles neither the converter nor any `markdown.ts`. `@affordances/md/next` re-exports the same functions, so existing imports keep working.
