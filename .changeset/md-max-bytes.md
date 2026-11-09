---
'@affordances/md': patch
---

A page larger than `maxBytes` answers `413` saying what to change: its limit, and the line that raises it in the md route (`export const GET = createMdHandler({ maxBytes })`). The server logs the same, with the page's path, so a page that grows past the limit is caught. The setup docs now show replacing `init`'s one-line route to set `maxBytes` and `timeout`. The default stays 6 MiB.
