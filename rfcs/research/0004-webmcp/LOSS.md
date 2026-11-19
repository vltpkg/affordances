# What WebMCP keeps of version 1 (M7d)

RFC 0004 §6's assumption 9, measured for WebMCP as M7c measured MCP (`packages/mcp-v1/loss/`). The setup:

- hosting-lab, served from a clean build of c5893029;
- opened in Chromium 156.0.8078.4, headless, with `--enable-features=WebMCP`;
- the page's tools registered by `@affordances/webmcp`, under policy `exhaustive`;
- each tool called from outside the page through `document.modelContext.executeTool`, as a harness bridge calls it.

`measure.mjs` is the instrument, and `loss-hosting-lab.json` is its output.

## Generic mode (the default)

- **Results:** all 135 calls equal protocol 1's response, value for value, through the same session. That's `project` for each of the views' 4 starts, `expand` on every `omitted.expand` entry, and `inspect` on every offer. Nothing a view says is lost.
- **A refused execute:** on a call needing confirmation, the tool's refusal differs from protocol 1's in two places:
  - `confirmation.approval`, which the boundary removes, so no token is shown to the model;
  - `confirmation.expiresAt`, which is the direct request's own: it's a second refusal, made a moment later.
- **Tool lists:** the browser keeps each tool's name, description and input schema exactly.
- **Hints:** it keeps `readOnlyHint`, and adds its own hints at their defaults (`consequentialHint`, `untrustedContentHint`, `debugging`).

The generic mode's only loss is therefore the same as on MCP: per-tool hints, and on WebMCP just those outside the browser's vocabulary.

## Per-capability mode

All 9 of hosting-lab's capability tools were registered, with a no-op execute, to see what the browser keeps of each:

| Kept as registered            | Of 9              |
| ----------------------------- | ----------------- |
| name                          | 9                 |
| description, charges included | 9                 |
| input schema                  | 9                 |
| `readOnlyHint`                | 9                 |
| `destructiveHint`             | 0                 |
| `openWorldHint`               | 0                 |
| `idempotentHint`              | 0 (of 3 declared) |

- **What gets registered:** the shared core (`@affordances/runtime/agent`'s `exportable`) registers only capabilities open to anyone: 1 of 9 here, as on MCP. So M7c's field-by-field table for MCP, `packages/mcp-v1/loss/hosting-lab.json`, holds for WebMCP's per-capability mode too.
- **What's worse on WebMCP:** the irreversibility and external-effect hints, which MCP keeps as booleans, aren't kept at all.
- **What the person's session doesn't change:** although the page runs in the person's session, nothing gained from that reaches the tool list, because the filter is the core's.

## Findings, for M7e

1. **Generic carries the whole of version 1.** That supports intake's default, generic, by measurement.
2. **Per-capability on WebMCP loses more than on MCP:** the irreversibility and external-effect hints are dropped by the browser.
3. **The generic `execute` tool's description, as measured, was wrong for WebMCP.** It said "the server asks them directly and runs it only if they accept". On WebMCP, no current browser lets a tool ask (no `requestUserInteraction`), so the call returns the refusal, and the person confirms in the app. Since fixed in e2a9bd77, which makes it transport-neutral: "If it needs the user’s approval, it runs only once they approve it; otherwise this returns the refusal, with its summary for them."
