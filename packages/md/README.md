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

It needs Next.js 16 or later, with the App Router. It's tested on Next 16.0.0, 16.0.11, 16.1.7, 16.2.12, 16.3.0, 16.3.8, 16.4.6 and 16.5.0-canary.46; `partialPrefetching` is a Next 16.3 option, and the rest works from 16.0. Where it reads something Next doesn't document (its streamed error rows, the `Cache-Control` it writes), a Next that changes it gets private markdown, never a public or wrong answer. A canary is a prerelease, which no version range matches, so installing md next to one needs `--legacy-peer-deps`.

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

`init`'s route is one line, `export { GET } from '@affordances/md/next'`, and it's your file. To set options, replace it: `export const GET = createMdHandler({ maxBytes: 32 * 1024 * 1024, timeout: 20_000 })`. `maxBytes` (6 MiB by default) is the largest page HTML it converts; past it, the page answers `413` with the line to change, and the server logs it. `timeout` (10 seconds) is how long a page has to stream.

Every page answers with `Link: </x.md>; rel="alternate"; type="text/markdown"`, so agents can find the markdown (`md({ link: false })` turns it off). For a `<link>` in the HTML too, add `alternates: mdAlternate(path)` to `generateMetadata`.

`llms.txt` (an index of every page's markdown) and `llms-full.txt` (every page in one file) are one line each. They list every page that needs no params, found in `app/` (and, on an Affordances site, the site index's routes); pass `sections` / `pages` to `createLlmsTxtHandler` / `createLlmsFullHandler` to name pages behind dynamic routes:

```ts
// app/llms.txt/route.ts
export { GET } from '@affordances/md/next/llms'
// app/llms-full.txt/route.ts
export { GET } from '@affordances/md/next/llms-full'
```

## How it works

`md()` adds rewrites (no `proxy.ts`): `Accept: text/markdown` at a page's url, `/x.md`, and `/index.md` all go to the route handler. An app that has its own `proxy.ts` uses `mdProxy(request)` from `@affordances/md/next/proxy` (the matching without the handler, so the proxy's bundle stays small): run every gate on `md.page`, the page a request is for whether it asks for HTML or Markdown, answer with `md.redirect(url)` (a Markdown request goes to the target's `.md` on this site), and end with `md.next()`. `isMdRequest` and `mdRewrite` are the same match, lower level. For a route whose public URL isn't its folder's (one the proxy rewrites, so `md()`'s `Link` rules miss it), `mdLink(request)` gives the proxy the `Link` value to set; it replaces any `Link` the config would set on that URL, so use it only where `md()`'s rules miss. Next hides a client navigation's `RSC` header and `_rsc` param from the proxy unless `skipProxyUrlNormalize` is on, so `mdRewrite` can send one to the handler; the handler sees the header again and passes the page's own RSC response through, never markdown. The handler fetches the page from its own origin as HTML, forwarding the caller's cookies, so the markdown is the real render: RSC, data, auth, and streamed `<Suspense>` content included. It then converts the HTML. Content rendered only on the client (in `useEffect`) isn't included.

A route whose public URL isn't its folder's, one a proxy maps onto it, is declared once: `md({ aliases: { '/package/@:scope/:name/:rest*': '/package/@:scope%2F:name/:rest*' } })`, in Next's rewrite syntax. Its public URLs then get the `Link` header, twin links and their route's `markdown.ts`, with `params` as `page.tsx` gets them (`{ pkg: '%40babel%2Fcore' }`). Each alias is checked when the config loads.

On a route whose pages' own URLs can end in `.md` (a registry with a package named `readme.md`), `md({ literalMd: ['/package/:name'] })` lets the handler tell them apart. It fetches the exact URL first: any answer but a 404 is the page (converted for a Markdown request, passed through as HTML otherwise), and a 404 means the `.md` is the twin suffix. Twins stay at the page's URL plus `.md` everywhere. Each twin request on those routes costs the 404 render first.

| Marker               | Effect                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `<AgentSkip>`        | Left out. `data-affordances-md="skip"` on any element does the same.                     |
| `<AgentMain>`        | If any are present, only these subtrees are used, in document order.                     |
| `<AgentOnly>`        | Included for agents and hidden from people. It must say what the page already shows.     |
| `<AgentText md="…">` | People see the children; the markdown gets `md` verbatim. Add `block` for its own block. |

Markers render `<affordances-md style="display:contents">`, so they don't affect layout and ship no client JS.

`data-affordances-md="show"` keeps a panel people open on the page (a tab panel or an accordion's content, with Radix's `forceMount`) though it's hidden. A tab panel is headed by its tab, and the tab list is left out.

Without markers, the converter uses `<main>` (or `[role=main]`); failing that, it uses the body minus `nav`, `header`, `footer`, `aside`, dialogs, and hidden content.

- **Forms:** listed as the fields they ask for, with radio groups labelled by their legend. Values, hidden inputs, and tokens are never output, unless the form opts in with `data-affordances-md="values"` (a settings page). Then each field's value is listed, except for hidden, password, and secret-looking fields.
- **Cleanups:** skeleton tables (no cell text, or a header over empty rows) are dropped, a run of the same link becomes one, and inline elements spaced only by CSS get a space between words.
- **Code:** fences keep their language and title, where `language-*` classes, `data-language`, `data-title` or a `<figure>`'s `<figcaption>` put them (rehype-pretty-code, Expressive Code, fumadocs).
- **Twin links:** in the handler's markdown, links to the site's own pages (the ones `md()` found) point at their `.md` twins, keeping query and hash; other origins, `#fragments`, files and API routes are left alone. `createMdHandler({ linkTwins: false })` turns it off, and `htmlToMarkdown(html, { link })` takes the hook directly.
- **Never output:** buttons, scripts, styles, comments, and `data-*` attributes.
- **Frontmatter:** title, description, canonical url, og:image, and lang.
- **JSON-LD:** appended as fenced blocks.

`htmlToMarkdown(html, options)` from `@affordances/md` is the converter on its own: pure and deterministic, with no React or Next.

## markdown.ts

A route can give its Markdown from its data instead of its rendered HTML: put a `markdown.ts` next to its `page.tsx`.

```ts
// app/products/[slug]/markdown.ts
import type { MarkdownArgs } from '@affordances/md/next'

export default async function markdown({ params, searchParams, request }: MarkdownArgs) {
  const product = await api.products.get(String(params.slug))
  return { title: product.name, markdown: `# ${product.name}\n\n${product.description}` }
}
```

A page that renders on the server except for one part fills only that part: `<AgentSlot name="readme"><Readme /></AgentSlot>` in the page, and `export const slots = { readme: async ({ params }) => readme } satisfies Slots<'/package/[pkg]'>` in `markdown.ts`. The page renders first (so its redirects, `notFound()` and layout checks run before any fill), only the slots it rendered once run, and the rest converts as usual. A slot's own condition (`{isOwner && <AgentSlot …>}`) doesn't gate its fill, since user HTML can carry a slot marker, so each fill authorizes its own data, as `markdown.ts` does.

It returns a string, `{ markdown, title?, description? }` (the handler adds the frontmatter, runs `append`, and counts tokens), a `Response` (sent as it is), or `undefined` (the page's HTML is converted as usual; development logs a warning). `md()` finds each `markdown.ts` next to a page, writes `.affordances/md.ts`, and aliases `@affordances/md/routes` to it; adding one in `next dev` needs a restart. Name the route for typed `params` (`MarkdownArgs<'/products/[slug]'>`); the generated file checks each `markdown.ts` against its route, once `".affordances/**/*.ts"` is in `tsconfig.json`'s `include`, which `affordances-md init` adds (keeping your comments). `md()` never edits `tsconfig.json`; it says the line when it's missing. Next's `notFound()`, `forbidden()`, `unauthorized()` and `redirect()` work in it: 404, 403, 401, or a redirect to the target's `.md`.

`export const publicCache = 'hours'` (a `cacheLife` profile, or `{ revalidate, expire? }` in seconds) lets a CDN keep a route's `.md` for anonymous visitors, with the `Cache-Control` Next sends for a page cached that long; a signed-in or negotiated request, a partial page or one that sets a cookie stays `private, no-store`. A `markdown.ts` with only `publicCache` opts in a page converted from its HTML.

**It doesn't render the page, so auth checks in a layout or page don't run for it.** Your `proxy.ts` runs once, on the requested URL, so never skip its gate for markdown requests (0.1.0's recipe did; remove that before adding a `markdown.ts`); gate on `mdProxy(request).page`. A request straight to the handler's URL, or at a URL Next wouldn't route to the page, never runs `markdown.ts`. Read data only through fetchers the API authorizes with the request's cookies or token, so it shows only what that person could see. With credentials, the response is always `private, no-store`.

## Caching and privacy

Markdown rendered with the caller's cookies or authorization, or from a page that is `private`/`no-store` or sets cookies, is sent as `private, no-store`. Otherwise it mirrors the page's `cache-control`.

- **Redirects:** a same-origin redirect becomes a redirect to the `.md` url, including a `redirect()` that runs after the page started streaming (Next sends that as a 200 that refreshes; the handler answers 307, or 308 when permanent). A cross-origin redirect is passed through, never followed.
- **Errors:** a `notFound()`, `forbidden()` or `unauthorized()` that runs after the page started streaming (Next sends the shell as a 200, then the error) answers `404`, `403` or `401`, `private, no-store`, never the shell's markdown. A page with a boundary that caught any other error (an `error.tsx`) keeps its status, and is `private, no-store` with `x-affordances-md-error: 1`, since part of it is missing.
- **Limits:** a page has 10s to render (`timeout`) and at most 6 MiB of HTML (`maxBytes`). A page still streaming at the timeout is converted as far as it got: unresolved boundaries keep their fallback, a note says so, and the response is `private, no-store` with `x-affordances-md-partial: 1`. One that sends nothing by then is a `504`.
- **Origin:** set `AFFORDANCES_MD_ORIGIN` when the server can't reach itself at the request's origin. A path that would leave the origin (`//host/…`) answers 400 before anything is fetched.
- **Headers:** `createMdHandler({ headers })` adds request headers to the page fetch, e.g. `x-vercel-protection-bypass` on a protected preview.

## Copy Page and Open in

`@affordances/md/react/client` has `usePageMarkdown(path)`, whose `load` and `preload` fetch a page's markdown twin for a Copy Page button (preload on hover, so Safari's clipboard write lands in time), and `openInHrefs({ prompt })`, for links that open the page in Claude, ChatGPT, or Claude Code.
