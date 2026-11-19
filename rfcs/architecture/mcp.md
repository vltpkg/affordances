# MCP and the version 1 wire

How version 1 of the protocol is exported: over HTTP from the projection route, over MCP from mcp-v1, and through one
tool core that MCP and WebMCP share. v0, the earlier route-and-action protocol, keeps its own MCP server. The
specification is [RFC 0004](../0004-protocol-evolution.md), as amended: §1 to §4 and §8 here, and §5, WebMCP, in
[webmcp.md](./webmcp.md).

| Package                 | Version          | Speaks | What it is                                                                      |
| ----------------------- | ---------------- | ------ | ------------------------------------------------------------------------------- |
| `@affordances/protocol` | 0.5.1, published | v0     | v0's wire types, schemas, fixtures and `spec.md`                                |
| `@affordances/mcp`      | 0.5.1, published | v0     | v0's MCP server and CLI, `affordances-mcp <site-url>`                           |
| `@affordances/mcp-v1`   | 0.0.0, private   | 1      | version 1's MCP server, over any adapter                                        |
| `@affordances/runtime`  | 0.0.0, private   | 1      | the shared tool core (`./agent`) and the in-process adapter (`./agent-runtime`) |

## Where it lives

| Concern                        | Code                                                                | Tests                                                         |
| ------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| the shared tool core           | `packages/runtime/src/agent.ts`                                     | `packages/runtime/test/agent.test.ts`, `http-adapter.test.ts` |
| the in-process adapter         | `packages/runtime/src/agent-runtime.ts`                             | `apps/hosting-lab/test/transports.test.ts`                    |
| version 1's MCP server         | `packages/mcp-v1/src/server.ts`                                     | `packages/mcp-v1/test/server.test.ts`, `boundary.test.ts`     |
| what per-capability mode loses | `packages/mcp-v1/src/loss.ts`                                       | `packages/mcp-v1/test/loss.test.ts`, `packages/mcp-v1/loss/`  |
| v0's MCP server                | `packages/mcp/src/server.ts`, `client.ts`, `cli.ts`                 | `packages/mcp/test/mcp.test.ts`                               |
| version 1 over HTTP            | `packages/next/src/projection.ts` ([next.md](./next.md#the-routes)) | `packages/next/test/projection.test.ts`                       |

## Version 1 over HTTP

The specification is [§1 and §2](../0004-protocol-evolution.md#1-v0-what-stays-what-changes-what-goes).

- **v0 stays as it is,** additive only. Version 1 is served beside it, never replacing it.
- **Discovery:** the site index gains `capabilities: { manifest, base }`, and the manifest is served at
  `/.well-known/affordances/manifest.json` ([next.md](./next.md#the-routes)).
- **Endpoints,** under `{base}`: `GET view` and `inspect`, `POST expand`, `check` and `execute`. A request carries the
  view's parameters: a `policy` (one of the built-in ones, or a 400), a `start` (`type:key`, or a capability or resource
  type id), `seen`, `task` and `offers`.
- **The media type** is v0's with a parameter, `application/vnd.affordances+json; version=1`, on every protocol-1
  response. The manifest is `application/json`, since it's the canonical IR, not a protocol-1 body.
- **Statuses:** a runtime result's is the runtime's `statusOf` (401 with a challenge or 403 for `unauthorized`, by
  the principal). A refusal the route makes before the runtime has a fixed status instead: 403 for the Origin, 400
  for a malformed body, 404 for a missing offer or operation. Either way the body is the runtime's refusal shape
  ([§2.3](../0004-protocol-evolution.md#23-the-rules-every-endpoint-keeps)).

## The shared tool core

`packages/runtime/src/agent.ts` is what an agent's tools are, on MCP and on WebMCP alike, so the two can't drift
([§3](../0004-protocol-evolution.md#3-the-tool-surface-rfc-0003s-four-adopted)).

- **The generic tools,** RFC 0003's four, adopted: `project { start? }`, `expand { from, along }`, `inspect { offer }`
  and `execute { offer, input? }`. The first three are marked read-only. `expand` takes every direction, `comparison`
  included.
- **The per-capability option:** one tool per capability, named by its id, with its charges in its description and
  four hints, from `safe`, `idempotent` and the effects. Only what everyone may do is exported (`exportable`: authorization `any`, and not an event), so on hosting-lab it's 1
  of 10, `hosting.plan.list`. Each field's fate in a capability's tool comes from `capabilityToolFates`, beside
  `capabilityTool`, so the loss report reads the tool as it's built (since 128a6582).
- **The token boundary:** `createToolset` holds the approval token, and the model never does. `toModel` strips every
  `approval` field and any token-shaped text from what a tool returns. Only the person's explicit accept, through the
  transport's own confirmation, spends a token.
- **Adapters:** `httpAdapter(base, fetch, view)` speaks version 1 over HTTP, `GET view` and `inspect`, `POST expand` and
  `execute`, never `check`. It keeps the connection's start until a `project()` names another. A refusal on a view, an
  expansion or an inspection is thrown with its detail; on an execution it's the result, as the runtime's own refusals
  are. `createRuntimeAdapter` is the same over an in-process runtime, and since 5f8a2c2b it also compares an execution
  from the last `project()`'s start, so the same calls give the same changes on both.

## MCP

The specification is [§4](../0004-protocol-evolution.md#4-mcp).

- **Version 1's server,** `createMcpServer`, runs the shared core over any adapter: in process through
  `createRuntimeAdapter`, or over HTTP through `httpAdapter`. Its options are the in-process adapter's, apart from the caller, with its own `mode` and `elicitTimeoutMs` (since
  128a6582). Its mode is `generic`, the default, or `per-capability`. A
  connection's start is the host's to set. It has no CLI and sets no server instructions.
- **Confirmation** is the person's, through the client's elicitation when the client declares it, with a 300-second
  default timeout. Without elicitation, nobody confirms: the agent gets the refusal, and no token.
- **What per-capability mode loses,** field by field, is `lossReport`, regenerated by `loss.test.ts`. On hosting-lab,
  of 136 fields over its 10 capabilities, it carries 2, 1 more at the call, and loses 133, 127 of them on the 9
  capabilities it doesn't export (`packages/mcp-v1/loss/hosting-lab.json`, since 095bb65c; M7c's report, 121 of 124,
  is kept as `hosting-lab-3a02e2c8.json`). The summary is in
  [`rfcs/research/0004-fidelity.md`](../research/0004-fidelity.md).
- **Its dependencies:** ir, runtime, `@modelcontextprotocol/sdk` and zod. mcp-v1's code doesn't import zod. It's there
  for the SDK, which declares zod both as a dependency and as a peer that isn't optional (`^3.25 || ^4.0`): providing
  the peer keeps the SDK on the workspace's zod, so it isn't to be removed as unused.

## v0's MCP server

`@affordances/mcp` is v0's: two tools, `affordances_open { path }` and `affordances_call { path, action, input?,
confirm? }`, over HTTP to any v0 site. It authenticates with a bearer from `--token` or `AFFORDANCES_TOKEN`, or keeps
cookies and sends `Origin`. Its server instructions describe the site from its index. v0's own `confirm: true` resend is
never version 1's approval.

## v0 interop

The specification is [§8](../0004-protocol-evolution.md#8-v0-interop-the-adapters-two-directions-m7b).

A v0 action's capability keeps its id, recovered exactly from its binding's `{ route, action }`, and v0's agent path
is checked by the runtime's `check`. M7b's golden check holds apps/example's v0 documents byte-identical.

## Not built, and divergences

- **Not built:** per-capability MCP for authenticated capabilities, events over MCP, and signing (RFC 0004's open
  questions, §10); WebMCP's view-following registration ([webmcp.md](./webmcp.md)); and the IR-to-v0 serving
  direction of §8, which has only its binding-identity test.
- **Not measured:** behavioural loss on each transport, elicitation in a real client, and policies other than the
  built-in ones ([`0004-fidelity.md`](../research/0004-fidelity.md)).
- **Divergences:** `protocol/spec.md` doesn't yet describe the index's `capabilities` field, which `SiteIndex` has.
  `elicitTimeoutMs`, `lossReport`, and the adapter's `approvalTtlMs` and `now`, are the API as built, not in the RFC.
