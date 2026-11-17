---
'@affordances/md': patch
---

Converting a page to markdown takes about half the time, and far less on some pages. The markdown is the same.

- The html is parsed without each node's place in the source. Nothing read it, and on a page of many lines working it out took longer than everything else together.
- The tree is no longer structured-cloned before it's converted, and its whitespace is collapsed without rebuilding the tag tests for every node.
- A page's chrome and its shown tab panels are found by reading each element's properties rather than with css selectors over the whole page.
