---
'@affordances/md': patch
---

A Flight script or a streamed boundary's instruction inside a `<noscript>`, or in MathML, is no longer trusted. md parses a page with scripting off, so it read such a script as one, but a browser never runs it there, so it was never Next's. A page that has one is read as untrusted Flight data. `readPage` reads it without its Flight data, and the route answers `502`, `private, no-store`. Hidden content such an instruction names stays hidden. A script a browser runs, including one in SVG, is read as before.
