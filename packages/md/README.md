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

`md()` adds rewrites (no `proxy.ts`): `Accept: text/markdown` at a page's url, `/x.md`, and `/index.md` all go to the route handler. An app that has its own `proxy.ts` can call `isMdRequest(request)` or `mdRewrite(request)` from `@affordances/md/next` for the same match, instead of copying it. The handler fetches the page from its own origin as HTML, forwarding the caller's cookies, so the markdown is the real render: RSC, data, auth, and streamed `<Suspense>` content included. It then converts the HTML. Content rendered only on the client (in `useEffect`) isn't included.

| Marker               | Effect                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `<AgentSkip>`        | Left out. `data-affordances-md="skip"` on any element does the same.                     |
| `<AgentMain>`        | If any are present, only these subtrees are used, in document order.                     |
| `<AgentOnly>`        | Included for agents and hidden from people. It must say what the page already shows.     |
| `<AgentText md="…">` | People see the children; the markdown gets `md` verbatim. Add `block` for its own block. |

Markers render `<affordances-md style="display:contents">`, so they don't affect layout and ship no client JS.

Without markers, the converter uses `<main>` (or `[role=main]`); failing that, it uses the body minus `nav`, `header`, `footer`, `aside`, dialogs, and hidden content.

- **Forms:** listed as the fields they ask for, with radio groups labelled by their legend. Values, hidden inputs, and tokens are never output.
- **Never output:** buttons, scripts, styles, comments, and `data-*` attributes.
- **Frontmatter:** title, description, canonical url, og:image, and lang.
- **JSON-LD:** appended as fenced blocks.

`htmlToMarkdown(html, options)` from `@affordances/md` is the converter on its own: pure and deterministic, with no React or Next.

## Caching and privacy

Markdown rendered with the caller's cookies or authorization, or from a page that is `private`/`no-store` or sets cookies, is sent as `private, no-store`. Otherwise it mirrors the page's `cache-control`.

- **Redirects:** a same-origin redirect becomes a redirect to the `.md` url. A cross-origin redirect is passed through, never followed.
- **Limits:** a page has 10s to render (`timeout`) and at most 6 MiB of HTML (`maxBytes`).
- **Origin:** set `AFFORDANCES_MD_ORIGIN` when the server can't reach itself at the request's origin. A path that would leave the origin (`//host/…`) answers 400 before anything is fetched.
- **Headers:** `createMdHandler({ headers })` adds request headers to the page fetch, e.g. `x-vercel-protection-bypass` on a protected preview.

## Copy Page and Open in

`@affordances/md/react/client` has `usePageMarkdown(path)`, whose `load` and `preload` fetch a page's markdown twin for a Copy Page button (preload on hover, so Safari's clipboard write lands in time), and `openInHrefs({ prompt })`, for links that open the page in Claude, ChatGPT, or Claude Code.
