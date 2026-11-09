---
'@affordances/md': patch
---

Fixed: on Next 16.3, a prerendered page whose `<Suspense>` child calls `notFound()`, `forbidden()` or `unauthorized()` while it's built is sent as a `200`, and converted as one. The handler now reads the error from the page's Flight data, where Next writes its digest as an error row (`NEXT_HTTP_ERROR_FALLBACK;404`) that a page's own content can't write. It answers `404`, `403` or `401`, `private, no-store`, and `llms` leaves the page out, as on 16.4.
