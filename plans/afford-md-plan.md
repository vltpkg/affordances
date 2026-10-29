# `@afford/md` — spec

> Serve any Next.js page as clean markdown at the same URL. Reliable because authors declare intent in components; heuristics only fill the gaps.

Read side of Afford. Works standalone (no `state.ts`/actions needed). Lives in `packages/md` of the Afford monorepo; same tooling as `PLAN.md` (vlt, tsdown, oxlint, oxfmt, vitest, changesets).

---

## 0. Rules for the building agent

- Ship in milestone order; each ends with build, typecheck, lint, fmt:check, test green.
- Converter is framework-agnostic and pure (string in → string out). Next glue is thin.
- No custom React renderer, no compiler hooks. Markers ride through normal SSR HTML.
- Never break the human page: markers must not affect layout, a11y or hydration.
- Golden-file tests for every conversion behavior. Output must be deterministic.
- Verify APIs (Next 16 `proxy.ts`, metadata `alternates.types`, unified/rehype packages) against current docs.

---

## Decisions (2026-10-28)

These override §1, §2 and §5 where they conflict.

- **Routing is next.config rewrites, not `proxy.ts`.** This matches `@afford/next`: nothing runs per request, and it works alongside any proxy the user already has.
  - `has: accept ~ text/markdown` handles content negotiation.
  - `missing: x-afford-md-render` is the loop guard.
  - An `afterFiles` rule handles `/x.md`.
  - Known gap: Accept q-values aren't compared. Browsers never send `text/markdown`, so that's acceptable.
- **Plugins compose.** A plugin is `{ name, rewrites, headers }` and owns a route under `/api/afford/<name>`.
  - Graph: `/api/afford/graph/[[...path]]`.
  - Markdown: `/api/afford/md/[[...path]]`. Separate folders, so neither catch-all swallows the other.
  - Combined: `withAfford(nextConfig, { name, plugins: [md()] })`.
  - Markdown only: `withMd(nextConfig)`.
  - Nesting works too, because every wrapper merges rewrites and headers.
- **The docs site switches to `@afford/md`** for `/page.md` and `Accept: text/markdown`, with markers in its layout. The fumadocs markdown route goes away, and `llms.txt` stays.

---

## 1. How it works

```
Agent: GET /blog/post  (Accept: text/markdown)   or   GET /blog/post.md
  → proxy rewrites to /api/afford/md/blog/post
  → handler fetches /blog/post from same origin as HTML
      (header x-afford-md-render: 1 so proxy doesn't loop; forwards cookies)
  → htmlToMarkdown(html): honor markers → extract main → convert → frontmatter
  → 200 text/markdown; charset=utf-8, Vary: Accept
```

Why self-fetch: reuses the real render (RSC, Suspense, data fetching, auth) with zero framework internals. Full body is awaited, so streamed/Suspense content is included. Client-only content (rendered in `useEffect`) is not — document this.

---

## 2. Package layout + exports

```
packages/md/
  src/
    convert/      # htmlToMarkdown, extract, handlers, frontmatter (no React, no Next)
    react/        # marker components (server-safe, no 'use client')
    next/         # proxy helper, route handler, metadata helper
```

| Export             | Contents                                                      |
| ------------------ | ------------------------------------------------------------- |
| `@afford/md`       | `htmlToMarkdown(html, opts)`, types                           |
| `@afford/md/react` | `AgentSkip`, `AgentMain`, `AgentOnly`, `AgentText`            |
| `@afford/md/next`  | `md()` proxy helper, `GET` route handler, `mdAlternate(path)` |

Deps (verify current): `hast-util-from-html`, `hast-util-to-mdast`, `mdast-util-gfm`, `mdast-util-to-markdown`, `hast-util-select`. Peer: `react >=19`, `next >=16` (only for subpaths that need them).

If `@afford/next` is installed, it composes `@afford/md/next` automatically (one proxy, one route). `@afford/md/next` must also work alone.

---

## 3. Markers (`@afford/md/react`)

All render a custom element `<afford-md>` with `style="display:contents"` (valid in phrasing and flow content, no layout effect). Server components; no client JS.

| Component                  | Renders                                       | Converter behavior                                                               |
| -------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| `<AgentSkip>`              | `<afford-md data-mode="skip">`                | drop subtree                                                                     |
| `<AgentMain>`              | `<afford-md data-mode="main">`                | if any present, output only main subtrees (in document order)                    |
| `<AgentOnly>`              | `<afford-md data-mode="only" hidden>`         | include; hidden from humans. Docs warn: must match visible content (no cloaking) |
| `<AgentText md="$160">`    | `<afford-md data-mode="text" data-md="$160">` | replace subtree with `data-md` verbatim (inline)                                 |
| `<AgentText md={…} block>` | same, `data-block`                            | replace as block-level markdown                                                  |

Props: `children`, plus `md`/`block` for `AgentText`. Escape attribute values. Nested markers: innermost wins; `skip` inside `main` respected.

Optional DX: `data-afford-md="skip"` attribute on any element behaves like `<AgentSkip>` (for third-party components you can't wrap).

---

## 4. Converter (`htmlToMarkdown`)

```ts
htmlToMarkdown(html: string, opts?: {
  url?: string                 // base for absolutizing links/images
  extract?: 'auto' | 'none' | ((tree: Root) => Root)
  frontmatter?: boolean        // default true
  jsonLd?: boolean             // append JSON-LD in fenced block, default true
  handlers?: Partial<Handlers> // per-element overrides
}): { markdown: string; title?: string; tokens: number }
```

**Order**

1. Parse to hast.
2. Read head: `title`, `meta[name=description]`, `link[rel=canonical]`, `og:image`, `html[lang]`, JSON-LD scripts.
3. Apply markers: `skip` removed, `text` replaced, `only` unhidden.
4. Extract:
   - `main` markers present → those only.
   - else `<main>` / `[role=main]` → that.
   - else heuristic: body minus `nav, header, footer, aside, [role=navigation|banner|contentinfo|complementary], dialog, [aria-hidden=true], [hidden]` (except `only` markers).
   - Always remove `script, style, noscript, template, svg, canvas, iframe, link, meta`.
5. Convert hast → mdast → markdown with GFM (tables, strikethrough, task lists).
6. Post-process: absolutize URLs, collapse blank lines, trim, normalize headings (single `#` = page title if none).
7. Prepend YAML frontmatter; append JSON-LD block.
8. `tokens` = `Math.ceil(markdown.length / 4)` (approximate).

**Element rules**

- Headings, paragraphs, lists, blockquotes, code (`pre>code` keeps `language-*` class as fence lang), tables, `hr` → standard.
- Links: keep text + absolute href; drop `javascript:`, empty and `#` links (keep text).
- Images: `![alt](src)`; drop if no alt and decorative (`alt=""`).
- Buttons: drop by default (actions belong to Afford graph).
- Forms: summarize as list of labeled fields, no values. Never output input values or hidden inputs.
- `details/summary` → bold summary + content. `dl` → `**term**: definition`.
- Inline formatting: strong/em/code/del/sup/sub.
- Unknown elements: unwrap to children.

**Never output:** hidden input values, CSRF tokens, `data-*` attributes, inline event handlers, comments.

---

## 5. Next integration (`@afford/md/next`)

**Setup**

```ts
// proxy.ts
import { md } from '@afford/md/next'
export default md({ include: ['/:path*'], exclude: ['/api/:path*'] })

// app/api/afford/md/[...path]/route.ts   (npx @afford/md init creates it)
export { GET } from '@afford/md/next'
```

**Proxy rules**

- Rewrite when GET/HEAD and (`Accept` prefers `text/markdown` over `text/html`, or path ends `.md`), path matches include/exclude, and `x-afford-md-render` absent.
- `.md` suffix stripped; `/index.md` → `/`.
- Skip `/_next`, `/api`, static files, and paths with extensions other than `.md`.
- Composable: `md({ … , next: existingProxy })` or exported `matchMd(req)` for manual composition.

**Handler**

- Build origin from request (override via `AFFORD_MD_ORIGIN` env for proxies).
- Fetch page with `x-afford-md-render: 1`, `accept: text/html`, forwarding `cookie`, `authorization`, `accept-language`.
- Upstream non-HTML → passthrough. 3xx → same redirect with `.md` appended to Location (same origin only). 4xx/5xx → same status, markdown body with title + status.
- Response headers: `content-type: text/markdown; charset=utf-8`, `vary: accept`, `x-afford-tokens`, `link: <canonical>; rel="canonical"`.
- Caching: if request had cookies/authorization, or upstream `cache-control` contains `private`/`no-store`, or upstream set cookies → `private, no-store`. Else mirror upstream `cache-control`.
- Timeout 10s (configurable). Max HTML 6 MiB → 413-style markdown error.

**Discovery**

- `mdAlternate(path)` returns `{ types: { 'text/markdown': path + '.md' } }` for `generateMetadata({ alternates })`.
- Optional: `llms.txt` route helper generating a list from `sitemap()` output — stretch goal.

**With Afford graph:** if the route has `state.ts`, `@afford/next` appends core's `toMarkdown(graph)` (state + `## Actions`) after page content. Not part of this package; just leave a hook: `opts.append?: (req) => Promise<string | undefined>`.

---

## 6. Security

- Self-fetch only to own origin; never follow cross-origin redirects.
- Forwarded cookies mean user-specific output → always `private`.
- Strip form values, hidden inputs, tokens (see §4).
- `AgentOnly` documented: same information as the human page; not for cloaking/SEO games.
- Loop guard: header + max one internal hop.

---

## 7. Tests

- **Unit (convert):** golden files in `test/fixtures/<name>.html` → `.md`. Cover every element rule, every marker, nesting, extraction fallbacks, frontmatter, JSON-LD, URL absolutizing, secret stripping.
- **Real-world corpus:** 10+ saved pages (docs page, blog, product page, dashboard-ish, marketing landing) with and without markers. Snapshot + assert no nav/footer leakage.
- **React:** markers render expected HTML, no hydration warnings, `display:contents` present.
- **Next e2e (fixture app):** Accept negotiation, `.md` suffix, loop guard, cookies → private, redirect rewrite, 404, non-HTML passthrough, Suspense content included.
- **Quality bench (optional, M4):** tokens + content recall vs baseline (Readability + Turndown) on corpus.

---

## 8. Milestones

| #   | Scope                                          | Done when                                                                        |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| A   | `htmlToMarkdown` + element rules + frontmatter | golden tests pass on fixtures                                                    |
| B   | Markers (React) + converter support            | marker fixtures pass; no layout/hydration diff in example                        |
| C   | Next proxy + handler + init + `mdAlternate`    | `curl -H 'Accept: text/markdown'` and `/x.md` work on fixture app; e2e green     |
| D   | Dogfood: docs + example use markers            | every docs page serves clean md; product page includes price/variants, no chrome |
| E   | Publish `0.1.0`, README, docs page             | quickstart works from scratch in <5 min                                          |

Stretch: `llms.txt` helper, quality bench, Afford graph append via `@afford/next`.

---

## 9. README first block (target DX)

```tsx
// proxy.ts
export { md as default } from '@afford/md/next'

// page.tsx
<AgentSkip><Banner /></AgentSkip>
<AgentMain><Article /></AgentMain>
<AgentText md="$160"><Price value={160} /></AgentText>
```

```
curl -H 'Accept: text/markdown' https://site.com/blog/post
```
