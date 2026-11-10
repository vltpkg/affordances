---
'@affordances/md': minor
---

Converter fixes for component-library HTML:

- Links side by side are spaced even when one holds an empty block, as an avatar stack's fallback `<div>` does: `[Ann](…) [Bo](…)`.
- A form without an `aria-label` or `aria-labelledby` gets no `**Form**` heading. What it already says, such as a card's title, stays in place.
- On a `data-affordances-md="values"` form, a checkbox, switch, toggle or lone radio button gives its state as `on`, `off` or `mixed`, unchecked included: `- Keep logs (checkbox): off`. A checkbox used to read `(checkbox, selected)`, and nothing when unchecked.
- Text isn't escaped where Markdown would only make it a link to itself: `tj@acme.dev`, `www.acme.dev` and `https://acme.dev` read as they are in paragraphs and table cells, as form values already did. Headings keep the escapes.
- A code block keeps its language from `data-language` on its `<code>` or `<pre>`, or a `language-*` class on its `<pre>`, and its title from a `<figcaption>` before it in its `<figure>` or a `data-title` on what holds it, as rehype-pretty-code, Expressive Code and fumadocs render them.
