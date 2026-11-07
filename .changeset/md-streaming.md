---
'@affordances/md': minor
---

md: a page still streaming at the handler's `timeout` is converted as far as it got, not answered with a 504. Unresolved boundaries keep their fallback, the markdown ends with a note, and the response is `private, no-store` with `x-affordances-md-partial: 1`. Streamed content also resolves past ten boundaries (React's ids are hex), into table rows, and through React's `$RR`, `$RS` and external-runtime reveal forms.

The `headers` option's `cookie` and `authorization` now apply only to a request that sent neither: a signed-in person's markdown renders with their own credentials alone, never as the service account, and an anonymous request still renders with the service's. A visitor with any cookie, even an unrelated one (analytics, consent), is rendered without the option's credentials: on a protected preview whose access rides on them, that visitor's markdown may be the protection or login page. A bypass in its own header, such as `x-vercel-protection-bypass`, always applies, so use one of those for protection bypass. Both are `private, no-store`.
