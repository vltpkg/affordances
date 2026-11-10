---
'@affordances/md': minor
---

On a route with `publicCache`, Markdown that stays private says why in `x-affordances-md-uncached`, in production too: `credentials`, `set-cookie`, `status`, `partial`, `error` or `invalid`. A gate that sets a cookie for a signed-out visitor was visible only in development before.
