---
'@affordances/md': minor
---

`createLlmsFullHandler`'s `pages` takes `{ url, title?, markdown }` as well as paths: `markdown` is a string or a function of the request, and the page is never rendered or fetched, so a site with a data layer skips the HTML round trip. Its links are made absolute and point at their twins, as a rendered page's are. Both run alongside the page renders, and a `markdown` function or an `append` that throws makes the file a `503`. `append` adds Markdown at the end of the file, with `createMdHandler`'s signature.

Both llms files are the public site, whoever asks: `pages`, `sections`, a page's `markdown`, `append` and the `headers` option get a request with none of the visitor's headers, and a request that sends a `cookie` or `authorization` gets its copy `private, no-store`. Before, the caller's own request reached them and the file was still cached publicly.
