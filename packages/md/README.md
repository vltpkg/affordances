# @affordances/md

Serve any Next.js page as clean markdown at the same URL. Authors mark intent with four components, and heuristics fill the gaps.

```tsx
// page.tsx
import { AgentMain, AgentSkip, AgentText } from '@affordances/md/react'

<AgentSkip><PromoBanner /></AgentSkip>
<AgentMain><Article /></AgentMain>
<AgentText md="$160"><Price value={160} /></AgentText>
```

```bash
curl -H 'Accept: text/markdown' https://site.com/blog/post
curl https://site.com/blog/post.md
```

## Setup

```bash
vlt install @affordances/md
vlx affordances-md init        # writes app/api/affordances/md/[[...path]]/route.ts
```

```ts
// next.config.ts: on its own
import { withMd } from '@affordances/md/next'
export default withMd(nextConfig)

// or next to the Affordances graph
import { withAffordances } from '@affordances/next/config'
import { md } from '@affordances/md/next'
export default withAffordances(nextConfig, { plugins: [md()] })
```

Every page answers with `Link: </x.md>; rel="alternate"; type="text/markdown"`, so agents can find the markdown (`md({ link: false })` turns it off). For a `<link>` in the HTML too, add `alternates: mdAlternate(path)` to `generateMetadata`.

`llms.txt` (an index of every page's markdown) and `llms-full.txt` (every page in one file) are one line each. They list every page that needs no params, found in `app/` (and, on an Affordances site, the site index's routes); pass `sections` / `pages` to `createLlmsTxtHandler` / `createLlmsFullHandler` to name pages behind dynamic routes:

```ts
// app/llms.txt/route.ts
export { GET } from '@affordances/md/next/llms'
// app/llms-full.txt/route.ts
export { GET } from '@affordances/md/next/llms-full'
```

## How it works

`md()` adds rewrites (no `proxy.ts`): `Accept: text/markdown` at a page's url, `/x.md`, and `/index.md` all go to the route handler. An app that has its own `proxy.ts` can call `isMdRequest(request)` or `mdRewrite(request)` from `@affordances/md/next` for the same match, instead of copying it. For a route whose public URL isn't its folder's (one the proxy rewrites, so `md()`'s `Link` rules miss it), `mdLink(request)` gives the proxy the `Link` value to set; it replaces any `Link` the config would set on that URL, so use it only where `md()`'s rules miss. Next hides a client navigation's `RSC` header and `_rsc` param from the proxy unless `skipProxyUrlNormalize` is on, so `mdRewrite` can send one to the handler; the handler sees the header again and passes the page's own RSC response through, never markdown. The handler fetches the page from its own origin as HTML, forwarding the caller's cookies, so the markdown is the real render: RSC, data, auth, and streamed `<Suspense>` content included. It then converts the HTML. Content rendered only on the client (in `useEffect`) isn't included.

On a route whose pages' own URLs can end in `.md` (a registry with a package named `readme.md`), `md({ literalMd: ['/package/:name'] })` lets the handler tell them apart. It fetches the exact URL first: any answer but a 404 is the page (converted for a Markdown request, passed through as HTML otherwise), and a 404 means the `.md` is the twin suffix. Twins stay at the page's URL plus `.md` everywhere. Each twin request on those routes costs the 404 render first.

| Marker               | Effect                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `<AgentSkip>`        | Left out. `data-affordances-md="skip"` on any element does the same.                     |
| `<AgentMain>`        | If any are present, only these subtrees are used, in document order.                     |
| `<AgentOnly>`        | Included for agents and hidden from people. It must say what the page already shows.     |
| `<AgentText md="…">` | People see the children; the markdown gets `md` verbatim. Add `block` for its own block. |

Markers render `<affordances-md style="display:contents">`, so they don't affect layout and ship no client JS.

Without markers, the converter uses `<main>` (or `[role=main]`); failing that, it uses the body minus `nav`, `header`, `footer`, `aside`, dialogs, and hidden content.

- **Forms:** listed as the fields they ask for, with radio groups labelled by their legend. Values, hidden inputs, and tokens are never output, unless the form opts in with `data-affordances-md="values"` (a settings page). Then each field's value is listed, except for hidden, password, and secret-looking fields.
- **Cleanups:** skeleton tables (no cell text, or a header over empty rows) are dropped, a run of the same link becomes one, and inline elements spaced only by CSS get a space between words.
- **Twin links:** in the handler's markdown, links to the site's own pages (the ones `md()` found) point at their `.md` twins, keeping query and hash; other origins, `#fragments`, files and API routes are left alone. `createMdHandler({ linkTwins: false })` turns it off, and `htmlToMarkdown(html, { link })` takes the hook directly.
- **Never output:** buttons, scripts, styles, comments, and `data-*` attributes.
- **Frontmatter:** title, description, canonical url, og:image, and lang.
- **JSON-LD:** appended as fenced blocks.

`htmlToMarkdown(html, options)` from `@affordances/md` is the converter on its own: pure and deterministic, with no React or Next.

## Caching and privacy

Markdown rendered with the caller's cookies or authorization, or from a page that is `private`/`no-store` or sets cookies, is sent as `private, no-store`. Otherwise it mirrors the page's `cache-control`.

- **Redirects:** a same-origin redirect becomes a redirect to the `.md` url. A cross-origin redirect is passed through, never followed.
- **Limits:** a page has 10s to render (`timeout`) and at most 6 MiB of HTML (`maxBytes`). A page still streaming at the timeout is converted as far as it got: unresolved boundaries keep their fallback, a note says so, and the response is `private, no-store` with `x-affordances-md-partial: 1`. One that sends nothing by then is a `504`.
- **Origin:** set `AFFORDANCES_MD_ORIGIN` when the server can't reach itself at the request's origin. A path that would leave the origin (`//host/…`) answers 400 before anything is fetched.
- **Headers:** `createMdHandler({ headers })` adds request headers to the page fetch, e.g. `x-vercel-protection-bypass` on a protected preview.

## Copy Page and Open in

`@affordances/md/react/client` has `usePageMarkdown(path)`, whose `load` and `preload` fetch a page's markdown twin for a Copy Page button (preload on hover, so Safari's clipboard write lands in time), and `openInHrefs({ prompt })`, for links that open the page in Claude, ChatGPT, or Claude Code.
