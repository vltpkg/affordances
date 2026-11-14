---
'@affordances/md': patch
---

A page nested thousands of elements deep no longer throws or takes minutes to convert. `htmlToMarkdown`, `readPage` and the route read anything nested more than 128 elements deep as its plain text, and a page nested more than 512 deep up to there. When either leaves something out, `readPage` says `cut: true`, and the route marks the page `x-affordances-md-partial`, with a note in the Markdown. The route also answers `502`, `private, no-store` for any error converting a page, as it does for Flight data it can't read, instead of the framework's generic `500`.
