# What each transport keeps and loses (M7e)

RFC 0004 exports version 1 over HTTP, MCP and WebMCP, beside v0. This page puts in one place what each transport keeps
of version 1 and what it loses, from M7c's and M7d's measurements. Each claim is marked by how it's known:

- **measured:** read from hosting-lab's real manifest or a real browser, with the instrument and its output committed;
- **tested:** held by a package's tests;
- **declared:** stated by an RFC, and not measured here.

It's structural: what each export carries. RFC 0004 §6's other half, whether a loss changes what an agent does, is
behavioural. M7f's pilot describes it for MCP and WebMCP (`apps/choice-bench/results/surfaces/PLAN.md` §3), and it
isn't claimed here.

## The table

Protocol 1 over HTTP (RFC 0004 §2) is the baseline: it carries all of version 1.

|                                                                                                             | MCP, generic                                                                                | MCP, per capability                                                                                                                           | WebMCP, generic                                                                                                                                          | WebMCP, per capability                                                                          | v0                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Which capabilities an agent can reach                                                                       | all, through views                                                                          | only those whose authorization is `any`: 1 of 9 on hosting-lab (measured)                                                                     | all, through views                                                                                                                                       | the same rule, from the same shared core: 1 of 9 (measured)                                     | those with a v0 binding: 8 of 9 on hosting-lab (backend's table, in progress)                                 |
| What a view says (availability, conditions, claims, relations, choice sets and their comparison, revisions) | all of it, as protocol 1 returns it, under every built-in policy (tested)                   | none of it: 121 of 124 declared fields lost on hosting-lab, as M7c measured it at 3a02e2c8 (`packages/mcp-v1/loss/hosting-lab-3a02e2c8.json`) | all of it: 135 of 135 calls equal protocol 1's, value for value, under the page's policy (measured)                                                      | none of it, as on MCP (measured through the shared core)                                        | none of version 1's additions (declared, RFC 0001 §10.2)                                                      |
| Capability ids                                                                                              | unchanged, in views                                                                         | unchanged, as tool names                                                                                                                      | unchanged, in views                                                                                                                                      | unchanged, as tool names                                                                        | recovered exactly from each binding's `{ route, action }` (declared, RFC 0004 §8)                             |
| Tool names, descriptions, input schemas                                                                     | the four tools', as defined                                                                 | each tool's, with the charges in its description                                                                                              | kept exactly by the browser (measured)                                                                                                                   | kept exactly by the browser, 9 of 9 (measured)                                                  | v0's own two tools                                                                                            |
| Tool hints                                                                                                  | the four tools' `readOnlyHint`                                                              | four, from `safe`, `idempotent` and the effects (declared, RFC 0004 §4)                                                                       | `readOnlyHint` kept; the browser adds its own at their defaults (measured)                                                                               | `readOnlyHint` kept; `destructiveHint`, `openWorldHint` and `idempotentHint` dropped (measured) | none                                                                                                          |
| Who confirms a consequential call                                                                           | the person, through the server's elicitation; without it, nobody: the refusal only (tested) | the same                                                                                                                                      | the person, in the app's own review-and-confirm step; in the tool only where the browser offers `requestUserInteraction`, which no build does (measured) | the same                                                                                        | the agent can: v0's `confirm: true` resend, never accepted as version 1's approval (declared, RFC 0001 §12.1) |
| Does a model ever hold an approval token                                                                    | no (tested)                                                                                 | no, in any mode (tested, in the shared core)                                                                                                  | no: absent from every tool response, in the real browser (measured)                                                                                      | no, in any mode (tested, in the shared core)                                                    | not applicable: v0 has no token                                                                               |
| Per-principal scope                                                                                         | the connection's principal                                                                  | none: only what anyone may do                                                                                                                 | the person's own session                                                                                                                                 | none: only what anyone may do                                                                   | each page's `expose`                                                                                          |

The sources:

- **MCP:** `packages/mcp-v1/loss/hosting-lab.json` and `plans.json`, regenerated by `packages/mcp-v1/test/loss.test.ts`, for the manifest as it is now; M7c's report on 3a02e2c8's manifest is kept as `hosting-lab-3a02e2c8.json`. The server's tests hold the generic mode's views equal to protocol 1's, byte for byte, under every built-in policy, and its token boundary, with elicitation and without. `packages/runtime/test/agent.test.ts` holds the shared core's: no tool result, in any mode, carries a token.
- **WebMCP:** `rfcs/research/0004-webmcp/LOSS.md` and `loss-hosting-lab.json`, from `measure.mjs`, in Chromium 156.0.8078.4 with WebMCP on. `packages/webmcp/test/` holds its consent branches and its token boundary.
- **v0:** RFC 0004 §8 and RFC 0001 §10. hosting-lab's v0 table, backend's work for M7f and not yet committed, binds 8 capabilities: the 7 consequential ones and `hosting.plan.list`. M7f's v0 oracle checks it.

## What it means

1. **The generic mode is the faithful export, on both transports.** It carries every view, so it loses only per-tool
   hints, which a view doesn't need: what a view says replaces them. That supports both defaults, RFC 0004 §4's for MCP
   and §5's amended one for WebMCP, by measurement.
2. **The per-capability mode is a catalog, not a projection.** It shows only what anyone may do, without any of the
   context a view carries. On hosting-lab, that's one read-only capability.
3. **The per-capability mode loses more on WebMCP than on MCP.** The browser keeps only `readOnlyHint`, so a tool list
   can't say an action is irreversible or reaches outside the app. Its description still states the charges.
4. **Confirmation never reaches the model on any version-1 transport.** It differs in who can give it. On MCP, the
   person can, through elicitation, where the client supports it. On WebMCP, today only the app's own page can. The
   limit RFC 0004 §5 states holds: an agent driving the page's DOM can click Confirm, as on any web app.
5. **v0 is the one surface where the agent can confirm for itself.** That's v0's model, kept for v0's clients, and the
   reason version 1 never accepts `confirm: true` as an approval.

## Not measured here

- **Whether these losses change what an agent chooses.** That's RFC 0004 §6's behavioural half, which M7f's pilot
  describes for MCP and WebMCP, and doesn't estimate.
- **MCP elicitation in a real client:** whether `claude -p` completes it non-interactively. M7f's pilot records it.
- **WebMCP under other policies.** The measurement ran under the page's policy, `exhaustive`. On WebMCP, the page
  chooses the policy, not the agent.
- **Headed browsers, and browsers other than Chromium.** The spike ran headless only (`SPIKE.md`).
- **WebMCP's per-capability registration following the view.** RFC 0004 §5 describes it as the option's behaviour.
  The shared core registers a fixed list from the manifest, so it isn't built, and isn't measured.
