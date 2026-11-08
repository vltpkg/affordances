---
'@affordances/md': minor
---

`mdProxy(request)` from `@affordances/md/next/proxy` gives a gated `proxy.ts` one object: `md.page`, the page the request is for whether it asks for HTML or Markdown (`/compare.md` is `/compare`), so every gate runs on the same URL; `md.markdown`; `md.redirect(url, status?)`, which sends a Markdown request to the target's `.md` when it's on this site (privately, varying on `Accept`) and any other target as a plain redirect; `md.next(init?)`, which sends a Markdown request to the handler and lets any other through; and `md.link`. The docs' gate-first recipe is now three lines around it. `isMdRequest`, `mdRewrite` and `mdLink` are unchanged.
