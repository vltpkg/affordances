---
'@affordances/md': minor
---

`md({ literalMd })` takes routes whose pages' own URLs can end in `.md`. There the handler fetches the exact URL first: the page wins if it answers with anything but a 404 (converted for a Markdown request, passed through as HTML otherwise), and a 404 makes the `.md` the twin suffix. Twin URLs are unchanged.
