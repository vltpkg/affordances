---
'@affordances/md': patch
---

Security: `llms.txt` and `llms-full.txt` write a page's own title and description as plain text: one line, with the brackets and angle brackets that link and autolink syntax react to escaped. A title such as `evil](https://evil.test/phish) [x`, or a description with blank lines and a `## heading`, can no longer add a link or a section to the public files. Frontmatter is read line by line, so a `U+2028` in a value can't pass for a key of its own.
