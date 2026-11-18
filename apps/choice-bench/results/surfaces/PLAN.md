# M7f: the six-surface comparison, the plan

**Status:** FINAL (design, 2026-11-18), fixed before any trial. It takes intake's rulings (09:20Z, 09:26Z, 14:24Z, 16:28Z and 16:33Z), the planner's (14:10Z to 17:13Z) and the agreements with backend through 16:53Z. Nothing here has run. Its method is RFC 0003, as amended, with §12's surfaces and §16's lesson for condition construction. The export it runs on is pinned at a commit containing this text, and a later commit names it.

## 1. The question

Through which surface does an agent most often reach the user's optimal end state on one task, and at what cost? The task, fixture, models and isolation are held fixed. As RFC 0003 §12 says, this reports when each surface helps and what it costs, not a winner.

## 2. What's held fixed, and checked mechanically

**§16's rule:** a condition differs from its control only in the factor it manipulates. Here that factor is the surface: the tools the agent is given, and what they return.

Everything else is byte-identical across the six, and the preflight refuses a run otherwise:

| held fixed                      | how the preflight checks it                                                                                                                                                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the fixture                     | one pinned export, at a commit after M7a, named in every trace. It is never pooled with c81eeeb1                                                                                                                                                                                                                      |
| the catalog and the manifest    | the manifest's digest, and the catalog's bytes, are the same in every cell                                                                                                                                                                                                                                            |
| the task                        | T6, with the same prompt bytes in every cell (RFC 0003 §2.2): M5's paragraph, then the surface's instruction line naming its tools, on its own line, then `The user: <T6>`. That line is the only prompt text that differs, and it's recorded; a test holds every surface's prompt equal but for it (backend, 15:03Z) |
| the owner's claims              | the confirmatory claim edit (Business recommended), identical in the manifest every surface reads                                                                                                                                                                                                                     |
| models, CLI, caps and isolation | RFC 0003 §5 and §8's pins, and the context canary, as in M5                                                                                                                                                                                                                                                           |
| the simulated user              | approves on every surface, as §12 says: the four tools' approval token, v0's `confirm: true` resend, the browser's confirm click (§3's approval note)                                                                                                                                                                 |
| the outcome                     | one rule per surface, from the trace and the session's `lab.endState`, cross-checked against `project.read` (§5), labelled by `tasks.ts`'s labeller                                                                                                                                                                   |

**The same start, on every surface** (intake, 16:28Z): every cell's agent starts from the user's project. On `full` and `progressive`, it's the in-process connection's start. On MCP and WebMCP, the host gives the connection its start: the trial's project on MCP, and the page's own project on WebMCP (RFC 0004 §4, §5). `v0` and `browser` have no projection, so there's no start to set: every page they open shows the session's own account, and the preflight records them as `pages`, without a start check. A start is a view parameter only: it grants nothing, and every call is still authorized as the caller's. The preflight checks each surface's first view is from that start, beside the offer-set check, and refuses a surface whose first view is site-wide.

**Information parity, per surface.** Surfaces are expected to differ in what they show first, so that's measured, not refused. The deciding facts must still be _reachable_ on every surface: every plan's price and `bandwidthGb`, the add-ons' prices, and the bundle's price.

- **The check:** before any trial, an oracle walk through each surface's own tools reaches all of them, extending ffb00260's disclosure test to every surface (backend, 09:21Z):
  - **`full` and `progressive`:** ffb00260's walk, every expansion plus inspect;
  - **On `full`, `progressive`, MCP and WebMCP,** a structured result shows a fact when one object holds the entity's slug and the fact's value together. Protocol 1 gives an add-on's and the bundle's price only in the rendered summary of the offer targeting it ("Add Daily backups to …, for 5 USD a month"), not as an attribute. So for prices only, and only on the offer targeting that add-on or bundle, the oracle also accepts ffb00260's existing rule: that offer's summary names "<price> USD" as a whole phrase. It's a pre-existing rule, adopted here after the first live preflight run found the miss (backend's step 7, ce11d26c). `v0` and `browser` find prices as attributes and page text;
  - **`v0`:** open every route in the SiteIndex, and read each graph;
  - **MCP and WebMCP:** call every query tool, and read the tool schemas;
  - **`browser`:** visit every page reachable from the start by links, and read each snapshot. This check reads text, so it's weaker: a fact passes only when its value appears in the same element as its label ("Pro" and "100 GB").
    - **"The same element," exactly** (agreed with backend, 15:03Z and 15:18Z): the snapshot is Playwright's accessibility snapshot in `ai` mode, the agent's own text, read as a tree, with its `[ref=…]` and `[cursor=…]` annotations skipped. A fact passes when, walking up from a node named exactly by the label, the smallest node that also holds a value node holds no other label of the same kind: plan, add-on or bundle. "Exactly" means "Pro" never matches "Pro Plus" or "Move to Pro". That's what stops Pro's "100 GB" being read off the "Extra bandwidth, 100 GB" add-on.
    - **A value node** is one whose own text holds the rendered value as a whole phrase: not preceded by a word character, `$`, a dot or a comma, and not followed by a word character. So "$20 a month" never matches inside "$120 a month", while "100 GB" matches "100 GB bandwidth", and a price still matches when a state follows it ("$20 a month, included in your bundle"). The values are rendered from the resolver's numbers through the page's own formats: "Free", or "$<n> a month", and "<n> GB" with thousands separators.
    - **The browser's `proAllowanceSeen`** uses the same matcher (§5).
  - The preflight prints each surface's found and missing facts, and for each fact found, the element or response it matched, so a near-miss can be audited.
- **On failure:** a surface that can't reach a deciding fact is refused, because its result would measure the gap, not the surface. That's M5's F lesson.

**Three more preflight checks** (backend, 09:21Z):

- **Server instructions:** no MCP server the run starts sends an `instructions` field. Otherwise the server would be prompt text that differs by cell, and the canary wouldn't see it.
- **Tool lists:** each surface's tool list, with its names, descriptions and schemas, is hashed and recorded. The instruction line naming the tools is the only prompt difference allowed.
- **The server's build:** every trial's server is the export's one production build, and its `.next` build id must be identical across trials, so the pages and the API are pinned too.

**What each surface shows first is recorded and diffed** per cell, as the audit's first-view diff did: the facts present in its first response. It's descriptive only, and never conditioned on in the three contrasts: where the first response depends on the agent's first call, it's post-treatment.

## 3. The surfaces

**The confirmatory four** (intake, 09:20Z), each on the same hosting-lab app:

| id            | surface                           | the agent's tools                                                                                                                                                                                                                                                                                                                                                                             | approval                                                     |
| ------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `full`        | protocol 1, the full graph        | the four tools, policy `exhaustive`, with §6.6's comparison                                                                                                                                                                                                                                                                                                                                   | the approval token                                           |
| `progressive` | protocol 1, the progressive graph | the four tools, policy `progressive`, with §6.6's comparison                                                                                                                                                                                                                                                                                                                                  | the approval token                                           |
| `v0`          | Affordances v0                    | packages/mcp's existing v0 tools, `affordances_open` and `affordances_call`, over the app's SiteIndex. Every consequential capability must be a v0 action on a page, so an agent can do whatever T6 allows. A read (`hosting.project.read`) and an event (`hosting.deployment.finished`) needn't be actions: their deciding facts must be reachable, which §2's walk checks (backend, 14:50Z) | a `confirm: true` resend                                     |
| `browser`     | browser automation                | choice-bench's own small MCP server over Playwright, which is already a devDependency, so nothing new. Its tools are fixed: `open(url)`, `snapshot()` (the accessibility tree as text, with element refs), `click(ref)`, `fill(ref, text)` and `submit(ref)`                                                                                                                                  | the confirm click on the review-and-confirm page (§3, below) |

**The approval column is a harness simulation** (the planner, 14:10Z; intake, 14:24Z). In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and the browser's click do; the product toolset never gives a model a token (RFC 0004 §4, §5).

- **In `full` and `progressive`,** the benchmark's four tools give the agent a `userApproved` token to resend: the simulated person's approval. That's deliberately parallel to v0's `confirm: true` resend and the browser's confirm click, so on all four confirmatory surfaces the agent performs the final act after a simulated approval.
- **Behind those tools** is a test-harness-only protocol-1 client in choice-bench, on the trial's hosting-lab server. The scoring replay stays in process.
- **It isn't the product's behaviour.** The product toolsets, `@affordances/mcp-v1` and `@affordances/webmcp`, never let a model hold a token, and the pilot's MCP and WebMCP cells use that real path. That's one reason they're descriptive only.

**Pilot only:** MCP and WebMCP. They're described, not estimated, and their confirmatory comparison is a later round.

**The browser cell stays on the site** (backend, 15:53Z). A link or redirect off the trial's origin is aborted at the browser context. The agent stays on the page it was on, and is told: "That goes to <url>, off the site, so it wasn't followed." The trial line records the browser's build, its Playwright version, its launch arguments and every aborted navigation, for the preflight. The browser's `proAllowanceSeen` reads every snapshot returned before the first review-page load.

**The server, on every surface** (the planner, 14:10Z): a port per worker, and a fresh server per trial.

- **What it is:** hosting-lab's one production build, from the pinned export, started fresh for each trial on its worker's port.
- **Its configuration:** set once at boot by env: the plan-id order, the trial's session and its claim edit. No endpoint exists that the agent could reach to change it.
- **Its start:** it's ready, by a health check, before the agent's first call. The start is outside the trial's timed window and its token counts.
- **The outcome** (the planner, 14:22Z): the server writes every session's `lab.endState`, M5's own ground truth, to a state file the harness names at boot, atomically after every store change, outside anything served. After the agent stops, the trial's session is read from it and cross-checked against `project.read` through the same session, on plan and add-ons. Then the server is stopped by its PID.
  - **Why not `project.read` alone:** it has no bundle, so "Pro plus the Pro Plus bundle" and "Pro plus priority support bought alone" read the same. Adding a bundle to it would alter the treatment every surface reads, to suit the instrument.
- **The inspector** stays off.

**The review-and-confirm page** (intake, 09:26Z). The new M7f export gives hosting-lab's purchase flow a review step before any charge, so every surface has a request event short of completion. It's design's work, after the boundary fixes, with e2e tests.

- **What it shows:** the capability's own confirmation summary, the same text the API surfaces return, with every charge, and the effective input rendered the same way.
  - **The parity test:**
    - **The element:** the page has one named element, `[data-confirmation-summary]`.
    - **The comparison:** the element's text content equals the runtime's rendered confirmation summary for the same capability and effective input, byte for byte, with no normalization.
    - **The effective input** is rendered by the same function the API surfaces use, and compared the same way.
    - **The enumeration,** fixed before any trial: every consequential capability T6's readings can reach, each with the inputs those readings produce.
- **What doesn't change:** v0's and the API's behaviour, and the manifest. The digest test guards the manifest.

**WebMCP, in the pilot,** is RFC 0004 §5's generic WebMCP: `@affordances/webmcp`'s four tools, registered by every hosting-lab page on load, under policy `exhaustive`.

- **The driver** (agreed with backend, 14:10Z): choice-bench's stdio MCP server opens hosting-lab in Playwright's Chromium with `--enable-features=WebMCP` and the trial's session. It waits for `document.modelContext.getTools()` to list the tools, and forwards each call through `executeTool`, so the agent sees exactly the page's tools.
- **Confirmation fails closed** (intake, 13:45Z). No current browser gives a tool `requestUserInteraction`, so a call needing confirmation returns only its refusal, with no token. That refused `execute` is the cell's request event.
- **Completion:** the simulated person then completes it in the app, as a person would. The driver opens hosting-lab's `reviewUrl(offer, input)` in the same page and session, and clicks `[data-confirm]`. That's the surface's mechanism, not a harness gap.
- **What it loses,** measured (rfcs/research/0004-webmcp/LOSS.md): nothing a view says, on 135 of 135 calls; the browser keeps only `readOnlyHint` of the tools' hints.

**MCP, in the pilot,** is RFC 0004 §4's generic MCP, `@affordances/mcp-v1`, with the approval elicited by the server.

- **What the pilot records:** how `claude -p` handles elicitation non-interactively (declined, unsupported, or other).
- **If elicitation can't complete,** MCP reports the intended measure only. That's stated as a harness limit, not as the surface's.

**There's no advocated cell,** in the pilot or the confirmatory run (intake, 09:26Z). §6.6's fix is checked by M7a's deterministic test instead.

## 4. Budget, and the pilot

- **The models:** Claude only, `claude-sonnet-5-5` and `claude-haiku-5-5`, with ids and the CLI pinned. Codex stays out until its isolation is solved.
- **The pilot:** 6 surfaces (the four, plus MCP and WebMCP) × 2 models × 5 trials = **60**, from the remaining 86. The 26 left are the margin, for retries and refused preflights, capped at 1 retry per trial.
- **What the pilot is for:** harness problems, tokens per trial, the per-surface variance, and whether the parity check holds on real runs. Its results are exploratory, and MCP's and WebMCP's are descriptive only.
- **The confirmatory run:** 4 surfaces × 2 models × **50** = **400**, the ceiling. It's interleaved and rotated as in M5.

## 5. Outcomes and analysis

**Estimation is primary, with no p-values** (intake, 09:20Z).

- **The request event, per surface.** It sets a trial's intended end state: the first request that applies wins (RFC 0003 §5.2).
  - **`full` and `progressive`:** an `execute` that's refused for confirmation, or that runs.
  - **`v0`:** the first consequential call, whether `confirm` is required or the call runs, and its `confirm: true` resend.
  - **`browser`:** the first load of the review-and-confirm page carrying a selection, and the confirm click.
    - **A load may be browsing,** like `inspect` rather than `execute`: an agent can open the review page only to read the total. Under first-wins, that load still sets the intended state.
    - **The pilot records** every review-page load followed, without confirming, by a different selection: a browsing load.
    - **The rule, fixed now:** if browsing loads occur in 0.20 or more of the browser's pilot trials that ran, the browser's request event becomes the confirm click together with the review-page load just before it. Otherwise the first-load rule stands, and browsing is reported as a limit.
  - **MCP (pilot):** its consequential `execute`, or its elicited approval.
  - **WebMCP (pilot):** its `execute`, refused for confirmation or run. It completes only through the review page (§3).
- **One rule everywhere** (intake, 09:26Z):
  - **the primary outcome:** the intended end state is optimal;
  - **beside it, on every surface:** completed, the session's `lab.endState` (cross-checked, §3) is optimal.
- **Completion is one store rule, on all six surfaces** (backend's 4c915b2a; the planner, 16:10Z): `completed = purchaseMade(start, end)`. It holds when the task's purchase was made, read from the session's end state, which is cross-checked against `project.read`, with `start` as the trial's fresh store.
  - **What counts:** a plan, bundle or add-on bought. A cancel, a removal, a downgrade or a deploy doesn't.
  - **It's new.** M5's "completed" was an approved re-execution, read from the trace. Here it's read from the store, so every surface is measured the same way.
  - **A refused Confirm** is the agent's outcome, and is scored. The review page answers it as an ordinary page (§3).
  - **If the catalog gains one-time charges,** backend may refine `purchaseMade` from the price to the items purchased, and the plan will say which.
- **The fallback, and its check,** fixed before the pilot.
  - **When it applies:** only if the pilot shows the review page distorting the browser arm. Then each contrast's primary becomes the strongest measure both arms can express: completed for `full` against `browser`, and intended for the others.
  - **The check:** the unconfirmed-request rate, a request event but no completed purchase, as a share of the trials that ran. It's compared between `browser` and `full`, pooled over both models (10 trials per arm in the pilot).
  - **The threshold:** a difference of 0.40 or more, either way, triggers the fallback. It's compared exactly, as a fraction.
    - **Why so coarse:** with 10 trials per arm, 0.40 is 4 of 10, so the check can only catch a gross distortion, such as agents stalling at the review page at a different rate. Noise alone rarely triggers it.
- **Harness faults** (intake, 14:24Z) are excluded from scoring and rerun, but COUNTED and reported per cell. There are two kinds, both defined mechanically:
  - **a harness-caused stall,** any one of:
    - a driver threw an error;
    - `click`, `fill` or `submit` couldn't resolve a ref that is in the immediately preceding snapshot. A ref the agent invented isn't a harness fault;
    - the app answered with a 5xx status;
  - **an outcome disagreement:** the session's `lab.endState` and `project.read` disagree on plan or add-ons (§3).
  - **The pause:** if harness faults number more than 2% of the trials run, or more than 2 in the pilot, the run pauses and intake is told.
    - **It's counted from disk,** from the set-aside fault records, so a resumed run counts exactly what the interrupted one did.
  - **At most two attempts per spec,** one retry, whatever the cause, as §4's budget caps it. The final attempt's class decides:
    - **a harness fault:** the spec is REPORTED MISSING in its cell, never imputed and never scored as failed. The reason: a harness fault says nothing about the model;
    - **a CLI crash or a 529:** it's scored failed, under intent to treat;
    - **an authentication failure:** the run stops.
  - **Each cell's table** shows its missing count beside its fault count.
  - **A consistency correction, made before the pin** (the planner, 17:40Z): this said "after 3 harness-faulted attempts" (backend, 208ea450), against §4's cap of 1 retry per trial.
  - **A change from M5:** M5 fixed and reran its stalls without counting them. Here every exclusion is counted and reported (the planner, 14:39Z).
  - **Every other trial that ran counts.** A trial that capped or failed isn't optimal (intent to treat, as in M5). A trial still missing after reruns is reported per cell, never imputed.
- **The three contrasts, fixed now:**
  1. `full` against `v0`;
  2. `full` against `browser`;
  3. `progressive` against `full`.
- **For each contrast:**
  - the Mantel–Haenszel risk difference across the two models, with its 95% interval (Sato's variance), and per-model risk differences with Newcombe's intervals;
  - a sensitivity, secondary: the same estimate with each missing spec counted as not optimal, so a conclusion that missing trials could overturn shows (review, 15:17Z). The primary never imputes;
  - heterogeneity between the models is an estimate, not a test: the difference of the two per-model risk differences, with a bootstrap percentile interval (10,000 resamples, a fixed seed). Per-model results lead when it's large.
- **The precision target,** at 50 per cell and near a rate of 0.5:
  - about ±19.6 points for a per-model difference;
  - about ±13.9 for the pooled difference.
  - Rates far from 0.5 give narrower intervals.
- **The cost side, secondary,** per surface and model, each with a 95% interval:
  - median tokens, excluding cache reads, with a bootstrap percentile interval, 10,000 resamples and a fixed seed recorded in the code;
  - tool calls, and latency (wall time per trial), as medians with the same interval;
  - the consequential-error rate, with a Wilson interval. A trial has a consequential error when any request event (above) would produce a state that satisfies no reading of T6, by `tasks.ts`'s readings, or when any call is refused as `unauthorized` (RFC 0003 §6's definition, applied per surface).
    - **How it's read:** the request events come from the trace, and their resulting states from the labeller's dry run, as for the outcome. On `browser`, the selection carried by each review-page load is labelled the same way.
- **Also descriptive:**
  - the text-stated rate (an upper bound, as in M5's audit);
  - completed purchases;
  - the information path: whether Pro's allowance was seen before the first approval request (`proAllowanceSeen`: some tool result before the first request event holds Pro's `bandwidthGb`, as the parity walk's matcher finds it, per surface), and what each surface's first response carried.
- **What isn't claimed:** a mechanism. Any reading of why a surface differs is labelled a hypothesis for a later pre-registered run, as in M5's §4.2.

## 6. Integrity, as in M5

- logins, config dirs, the canary and the email scan;
- the owner's files stamped before and after (intake, 09:03Z);
- interleaved, rotated order;
- 2 trials at once;
- the load gate;
- partial traces moved aside, never deleted.

## 7. Before any trial

0. **The gate on backend's fixes** (intake, 2026-11-18): backend's M5 boundary-review fixes are fixed, review-accepted, and accepted by intake (12:44Z): #7 in 3df5840c, #8 in 006e2902 with 26ec61c5 (the structured-error classing), #9 in 02889a28, and #15 in 49f7bf8f. That holds before any trial, the pilot included.

1. **Committed first:** this plan in final form, the analysis code (`analyze.py`, beside this plan, with its selftest), and the preflight. The pilot's analysis fixes the fallback and browsing rules, and the confirmatory analysis refuses to run without them. The preflight proves the conditions differ ONLY in the surface (§2): byte-identity outside each surface's tool layer, plus the parity walk.
2. **Agreed with backend (09:21Z; 14:10Z for WebMCP; 15:03Z and 15:18Z for the browser's matcher; 16:53Z for the oracle's prices):** the browser driver, the v0 tools, the parity oracle, the preflight's checks, and the WebMCP driver (§3). Backend builds the harness on row 47742e6d, in 8 reviewed steps, and the export.
3. **The new export,** with §6.6 built (M7a), named by its commit. Backend pins it at the harness's step 8, after every harness step is accepted.
4. **The review-and-confirm page** (§3), built and tested (accepted), on the export the run uses.
5. **Every results README,** the pilot's and the confirmatory run's, states the approval simulation in this one sentence, which the analysis code's README writer includes, with a test: "In the benchmark, token-passing stands in for the person's approval, as v0's confirm resend and the browser's click do; the product toolset never gives a model a token (RFC 0004 §4, §5)."
