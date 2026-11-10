---
'@affordances/md': minor
---

`maxBytes` counts the HTML the converter keeps, not Next's Flight data. The handler takes each Flight push out of the page as it streams, reading it for its error rows, so a big `partialPrefetching` page (most of whose bytes are Flight data) is never held whole and converts with the default. The default is now 16 MiB of kept HTML (was 6 MiB of the whole page), and the whole response can be up to 8 times `maxBytes`; past either limit the page answers `413`, naming which.
