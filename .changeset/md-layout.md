---
'@affordances/md': patch
---

Fixed: a list or paragraphs inside a `<dd>` ran into the term's line; they're now blocks after it. Blocks stacked in a table cell (`<div>`s, `<p>`s, or an element with a `block`, `flex` or `grid` class or `display`) ran together; they're now spaced.
