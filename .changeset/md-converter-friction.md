---
'@affordances/md': patch
---

Converter fixes from vlt.io's friction report:

- An `<AgentText>` inside a link keeps the link.
- Links named only by `aria-label`, links in wrappers and text in a flex or grid gap are spaced.
- Sortable table headers keep their button's label.
- Forms read ARIA switches, checkboxes, radios, toggles and selects, follow `aria-labelledby`, are named by their `aria-label`, `aria-labelledby` or first heading, keep their text in page order, and no longer escape `@` and `:` in values.
- A form's tables and definition lists keep their shape, with each field written where it is. A form named by its own `<legend>` or `<label>` keeps that name as its title.
- Fields and links are named as a screen reader names them: a switch, checkbox, radio or toggle button by its own words, and a link with nothing in it by its `aria-labelledby`.
- A heading, caption, summary or term whose only text is a button (an accordion's header) reads the button's text.
- A name never reads what's hidden from people or what carries a value (a textarea, an option, an output, meter or progress, an editor), and an editor (`contenteditable`, `role="textbox"`) is left out like a textarea.
