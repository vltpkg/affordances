---
'@affordances/md': patch
---

Converter hardening from the security audit: a page's own `data-affordances-md-text` is no longer output verbatim; links keep only their text unless they're `http`, `https`, `mailto`, or `tel` (checked as a browser parses them, so `java&#10;script:` is caught), and images need `http` or `https`; content hidden with an inline `display: none` or `visibility: hidden` is dropped; a field's placeholder or `name` is never its label; and `usePageMarkdown` refuses a path on another origin.
