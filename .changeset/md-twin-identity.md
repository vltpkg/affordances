---
'@affordances/md': patch
---

A twin asks for its page uncompressed (`accept-encoding: identity`): it's a fetch from the server to itself, where gzipping the HTML only to unzip it again cost more than the bytes saved.
