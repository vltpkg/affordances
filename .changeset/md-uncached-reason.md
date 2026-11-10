---
'@affordances/md': minor
---

Markdown that stays private says why in `x-affordances-md-uncached`, on any route and in production too: `credentials`, `set-cookie`, `status`, `partial`, `error`, `gate`, `negotiated`, `invalid` or `private`. Markdown is `private, no-store` unless the route's `publicCache` or the page's own `Cache-Control` makes it public, so a page that sends none is private. A gate that sets a cookie for a signed-out visitor was visible only in development before.
