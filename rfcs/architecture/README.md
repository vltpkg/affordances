# Architecture, as built

These pages describe the semantic capability system as it is built on this branch, from the accepted RFCs 0001 to 0005.
Where an RFC and the code differ, the page says so and names both. Where an RFC specifies something that isn't built, the
page marks it **not built**. The RFCs remain the specifications; these pages are their map onto the code.

The packages they describe, except next, mcp and protocol, are private at version 0.0.0 and unpublished. Publishing them is
the human's release decision (RFC 0005 §1), so nothing here is a public API yet.

## The pages

| Page                              | What it covers                                                                            | RFC               | Packages                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ |
| [The IR](./ir.md)                 | the capability manifest: its model, identity, composition, canonical form and digest      | 0001              | `@affordances/ir`                                                  |
| [The runtime](./runtime.md)       | the engine: loading, conditions, execution, outcomes, the approval token, resolvers       | 0002 §2, §8, §11  | `@affordances/runtime`                                             |
| [The projection](./projection.md) | what an offer discloses and why: views, choice sets, comparison, the disclosure invariant | 0002 §4 to §6     | `@affordances/runtime`                                             |
| [Next.js compilation](./next.md)  | how a Next.js app's capability modules become a manifest, and the routes that serve it    | 0005              | `@affordances/next`                                                |
| [MCP and the v1 wire](./mcp.md)   | version 1 over HTTP, the MCP servers, and the tool core MCP and WebMCP share              | 0004 §1 to §4, §8 | `@affordances/mcp`, `@affordances/mcp-v1`, `@affordances/protocol` |
| [WebMCP](./webmcp.md)             | version 1 in the browser                                                                  | 0004 §5           | `@affordances/webmcp`                                              |
| [The inspector](./inspector.md)   | the inspector UI                                                                          |                   |                                                                    |

RFC 0003 is the benchmark's method. It describes how the system is measured, not how it's built, so it has no page here.

## How the pieces fit

1. **An app declares capabilities** in `capabilities.ts` modules, with the IR's authoring API ([ir.md](./ir.md#authoring)).
2. **The build compiles them** into one canonical manifest and its digest, in `.affordances/` ([next.md](./next.md#what-the-build-emits)).
3. **The runtime loads the manifest** with the app's handlers and resolvers, and answers requests from one principal at a
   time: it projects views of offers, and executes calls through a fixed sequence of checks ([runtime.md](./runtime.md)).
4. **Transports export the runtime:** version 1 over HTTP from the Next.js projection route, over MCP from mcp-v1, and in the
   browser from WebMCP, the last two through one shared tool core ([mcp.md](./mcp.md#the-shared-tool-core)). Version 0, the
   earlier route-and-action protocol, is served beside it.

## What these pages don't cover

- **Measurements.** The benchmark's results are under `apps/choice-bench/results/`, with their own READMEs.
- **What a transport loses.** That's [`rfcs/research/0004-fidelity.md`](../research/0004-fidelity.md).
- **What a future specification would standardize.** That's the specification roadmap.
