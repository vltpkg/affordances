---
'@affordances/md': minor
---

Slots and links in markers:

- `<AgentSlot name>` marks a part of the page that `markdown.ts` fills, while the rest of the page converts from its HTML. A name rendered twice is filled nowhere.
- `readPage(html)` reads a page once: its `slots` lists the page's slots, `markdown(slots)` fills them, and `redirect` is a `redirect()` Next streamed into it. `htmlToMarkdown(html, { slots })` does it in one call.
- Links in `<AgentText md>` and in a slot's fill are made absolute and pointed at their Markdown twin, like the page's links.

Fixed: a block `<AgentText>` inside a paragraph ran into the paragraph's text, which was broken Markdown. It's now its own block between the paragraph's halves.
