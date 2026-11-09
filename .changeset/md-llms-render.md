---
'@affordances/md': patch
---

`llms.txt` and `llms-full.txt` render their pages 8 at a time instead of all at once (`concurrency` sets it), and each page's `timeout` runs from its own request. The whole file has a `deadline`, 25 seconds by default; pages not rendered by then are left out and counted. A page they leave out (a timeout, a status, a private render) is no longer silent: the files carry an `x-affordances-md-dropped` count, and in development the server logs each page and why. `llms-full.txt` heads each page with its title, falling back to its first heading when that's how the title starts or when the title is shared across pages.
