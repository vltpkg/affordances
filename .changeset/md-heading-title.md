---
'@affordances/md': patch
---

Fixed: the frontmatter `title` of a `markdown.ts` page, and its `llms-full.txt` heading, took its first `# ` line as written, link syntax and URL included (`[Methodology](https://…)`). It's now the heading's text: a link keeps its text, and a URL shown as itself is dropped. The page's own Markdown is unchanged.
