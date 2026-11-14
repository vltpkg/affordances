---
'@affordances/md': patch
---

Converts about 5× faster; the markdown is unchanged. Malformed HTML, and a few unusual placements (a form inside a link, strikethrough or table cell, a React streamed boundary that moves through an `<svg>` or into its own segment, an AgentMain inside a link that also holds tabs, form values or empty blocks, a slot inside a form control or an element other than plain containers, headings, emphasis, code, table cells, buttons, labels, summaries, forms and links, or in a link that holds a value or says nothing but values, a shown tab panel whose tab is inside a link or table, or tabs whose only shown panel is under a hidden element), can convert slightly slower.
