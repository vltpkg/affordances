---
'@affordances/md': patch
---

Big pages convert faster. Next's flight data is dropped before the page is parsed, the head is read in one pass, and a filled slot's own content is no longer converted only to be replaced. On a 4 MB page with `partialPrefetching`, its `.md` twin went from 6.3× the page's time to 3.6×.
