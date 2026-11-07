---
'@affordances/md': minor
---

The handler's markdown links the site's own pages to their markdown twins (`/blog/post` → `/blog/post.md`, query and hash kept), so an agent following a link stays in markdown. Opt out with `createMdHandler({ linkTwins: false })`. `htmlToMarkdown` takes the hook as a new `link` option.
