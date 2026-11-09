# streamed-{not-found,forbidden,unauthorized}-*.html: how they were captured

A Next app with no affordances in it: a root layout (a header, then `<main>{children}</main>`), and a page at
`/<fn>/late` that awaits `connection()`, waits 50 ms behind a `loading.jsx`, then calls `notFound()`, `forbidden()`
or `unauthorized()`. `next.config.mjs` sets `experimental.authInterrupts`. Built and started with Next 16.3.0 and
16.4.3 (React 19.3.1), saved with `curl -s localhost:<port>/<fn>/late`. Each answered `200 OK`, since the shell had
already been sent.

`streamed-not-found-cache-components.html` is the same app on 16.4.3 with `cacheComponents: true`, whose layout wraps
`children` in `<Suspense>`, as such an app must: there a page that calls `notFound()` before anything else (`/notFound/early`)
answers 200 as well. Without `cacheComponents`, that page answers a real 404, 403 or 401.

The error is in the stream as React's errored-boundary instruction, in a script of its own at the end:
`$RX("B:0","NEXT_HTTP_ERROR_FALLBACK;404")` (403, 401). Next also streams `<meta name="robots" content="noindex"/>`
before it, but a real 404 carries that too, and a page's own metadata can set it, so it isn't the signal. The flight data
holds the same digest (`E{\"digest\":…}`, quotes escaped) and, on every page, the not-found and forbidden templates
("This page could not be found."), so it isn't either.

`streamed-not-found-static-next16.3.html` is a page with nothing dynamic, prerendered by `next build` on 16.3.0, whose
`<Suspense>` child calls `notFound()` while it's built (`/static-notFound`). 16.3.0 sends it as a `200` (16.4.3 sends a
real `404`). Nothing streams, so there's no `$RX`: React writes the boundary it errored as
`<!--$!--><template data-dgst="NEXT_HTTP_ERROR_FALLBACK;404"></template>`, and Next puts
`<meta name="robots" content="noindex"/>` in the `<head>`. `forbidden()` and `unauthorized()` are the same with `;403`
and `;401`.
