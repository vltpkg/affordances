---
'@affordances/md': minor
---

`createLlmsTxtHandler` takes `note`: Markdown that replaces what the plugin says after the summary (that every page is Markdown, where `llms-full.txt` is, and on an Affordances site how to read its graphs), or `false` for none. The site's `intro` now comes after that note, not before it, so `llms.txt` reads title, summary, note, intro, sections. The default line on `llms-full.txt` is now "For the full text in one file, see llms-full.txt", which stays true when `pages` leaves some out. A section takes `sections` of its own, rendered under `###` down to `######`; one nested deeper throws, naming it.
