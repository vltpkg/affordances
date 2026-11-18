# WebMCP

Version 1's capabilities in the browser, over WebMCP: the page registers tools that an agent in the person's browser can
call, and every call reaches the app's runtime over protocol 1's HTTP endpoints, with the person's own session. The
specification is [RFC 0004 §5](../0004-protocol-evolution.md#5-webmcp), as amended. The package is `@affordances/webmcp`
(private, 0.0.0), and hosting-lab is the app that uses it.

## Where things run

- **In the page:** `registerWebMcp` builds the tools and registers them on the page's WebMCP context,
  `document.modelContext`, then the older `navigator.modelContext` (`packages/webmcp/src/index.ts`, `modelContext`). Where
  the browser has neither, it registers nothing and returns `[]`.
- **On the server:** the runtime, its resolvers, its handlers and its approval key. The page reaches them only through the
  projection route's endpoints, under `base` (RFC 0004 §2), with the person's cookie session
  ([mcp.md](./mcp.md) covers the wire).
- **Between them:** the shared tool core in `@affordances/runtime/agent`, which MCP uses too
  ([mcp.md](./mcp.md#the-shared-tool-core)): `createToolset` over `httpAdapter(base, fetcher, view)`. The package
  re-exports `httpAdapter` and `ViewRequest`, and adds only what is WebMCP's: the context, the registration and the
  consent detection.

## The tools

- **Generic, by default:** the four tools `project`, `expand`, `inspect` and `execute`, over the page's projection, as on
  MCP. `mode: 'per-capability'` is the option.
- **The view request rides on every call:** the page's `view` (its policy) and its `start` go into the adapter, which
  keeps the start a connection's last view was made from, so `expand`, `inspect` and `execute` read the same projection.
- **The start, from the page:** the resource the page is about, used when the agent's `project` names none. hosting-lab's
  root layout passes the session's own project (`apps/hosting-lab/src/app/layout.tsx`). A start is a view parameter only,
  and grants nothing: the route checks every offer and every call against the session's principal. A test drives the
  real `serveView` and `serveExecute` with another user's start, and gets nothing of theirs
  (`apps/hosting-lab/test/webmcp-start.test.ts`).
- **The per-capability option, as built:** a fixed list from the public manifest, one tool for each capability whose
  authorization is `any` (`exportable`, `packages/runtime/src/agent.ts`), named by its capability id
  (`capabilityTool`). A capability id always passes WebMCP's name rule. **Not built:** following the view, which would
  register a capability's tool when one of its offers appears and unregister it when they're all gone (RFC 0004 §5;
  `rfcs/research/0004-fidelity.md`).

## Registration and its lifetime

- **One registration per page, under a signal.** `registerWebMcp` takes an `AbortSignal` and passes it to every
  `registerTool` call. Aborting it unregisters the tools.
- **Why a signal:** Chromium 156's `modelContext` has no `unregisterTool`. A second `registerTool` under a live name
  rejects with `InvalidStateError: Duplicate tool name` and leaves the first. Aborting the signal a tool was registered
  with removes it, and the name can be registered again straight away. `rfcs/research/0004-webmcp/registration.mjs`
  measures each in Chromium 156.0.8078.4, and `registration.json` records its output.
- **In hosting-lab:** the `WebMcp` component (`apps/hosting-lab/src/components/webmcp.tsx`) registers in an effect and
  aborts in its cleanup, with the start's type and key as the effect's dependencies. That covers React's doubled effect
  in development, and a start that changes while the layout stays mounted.
  `apps/hosting-lab/test/webmcp-mount.test.ts` checks both against a context that behaves as Chromium does.

## Confirmation fails closed

The rule is RFC 0004's for every transport: an agent's own resend is never consent, and no tool returns a token to an
agent.

- **A call that needs confirmation:** when `execute` is refused with `confirmation_required`, the tool returns the
  refusal through `toModel`, the boundary every tool result passes. That removes `approval` wherever it appears, so the
  agent gets the rendered summary, charges included, and no way to approve.
- **Where the person confirms:** in the app's own review-and-confirm step. In hosting-lab that's `/review`, which shows
  the runtime's own confirmation summary for the same capability and input, and runs the call only on the person's
  Confirm (`apps/hosting-lab/src/lib/review.ts`).
- **In-tool consent, only where the browser offers it:** `confirmFor` feature-detects `requestUserInteraction` on the
  tool's client. With it, the tool asks the person, through the page's `ask`, to approve the summary, and resends with
  the token only on an explicit accept. The token never leaves the toolset. Chromium 156.0.8078.4 doesn't offer it (`rfcs/research/0004-webmcp/SPIKE.md`), so this
  path is tested against a fake client only (`packages/webmcp/test/webmcp.test.ts`).
- **The guarantee, exactly:** no tool channel ever yields an approval. Tests sweep every tool result for the runtime's
  token pattern, `TOKEN`.
- **The limit, plainly:** an agent that also drives the page's DOM can click the app's own Confirm, as on any web app.
  The guarantee is about the tool channel, not the page.

## What the browser keeps

Measured in `rfcs/research/0004-webmcp/LOSS.md`, on hosting-lab in Chromium 156:

- **Generic mode:** all 135 calls equal protocol 1's response, value for value, through the same session. A refused
  `execute` differs only in `confirmation.approval`, which the boundary removes, and in its own `expiresAt`.
- **Tool lists:** each tool's name, description and input schema are kept exactly.
- **Hints:** the browser keeps `readOnlyHint`, and drops hints outside its vocabulary.

## Beside version 0

v0's WebMCP tools are bare action names. Version 1's generic tools are `project`, `expand`, `inspect` and `execute`, and
its per-capability tools are dotted capability ids, so a page can serve both.

## Related

- [The projection](./projection.md): what the views the tools return disclose.
- [MCP and the v1 wire](./mcp.md): the endpoints, and the tool core shared with MCP.
- [The runtime](./runtime.md): execution, refusals and the approval token's binding.
