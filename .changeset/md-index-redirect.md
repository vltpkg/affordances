---
'@affordances/md': patch
---

Security: the llms handlers' site-index request never follows a redirect, so the `headers` option (a protection bypass, a token) never reaches the host it points to. A redirect there means no index.
