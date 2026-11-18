# M7d: WebMCP's default mode, the criterion

**SPIKE:** measurement for RFC 0004 §5, not product code.

This rule is fixed before anything is measured (intake, 2026-11-18 13:43Z), and committed first, as RFC 0005 §7's `SCORING.md` was. It isn't edited after the measurement runs. A wrong rule is fixed in a new, dated section, and both results are reported.

## The rule

WebMCP has both modes: **generic** (the four tools: view, expand, inspect and execute) and **per-capability** (one tool per capability, RFC 0004 §5).

- **The default is per-capability** if and only if its measured loss is **0**: every capability in hosting-lab's views, in every cell of the grid below, is **reachable** as a tool.
- **Any loss makes generic the default,** with the reason recorded in RFC 0004 §5's amendment.
- **M7f's pilot uses generic,** whatever the default.

## Reachable

A capability C is reachable in a grid cell when all of these hold:

1. **Offered:** some offer of C is in the cell's views. That means the first view, or any expansion of it, under the cell's policy and principal. An offer that's unavailable still counts as offered (RFC 0002 §6.3, rule 5).
2. **Registered:** the page registers exactly one tool for C, named C's id unchanged, while such an offer is in its view (RFC 0004 §5).
3. **Callable:** executing that tool with an input C's input schema accepts reaches the runtime's `execute` for C, through the app's protocol-1 endpoints, and returns that execution's result through `toModel`.
4. **Confirmed with the person's own browser consent,** when C requires confirmation: the tool, from inside its own execution, gets the person's consent through the browser's user-interaction mechanism, then resends with the approval, and only that resend completes C.
   - A consent the page's own script can't distinguish from an agent's DOM action doesn't count.
   - A tool that returns the call for the person to complete elsewhere doesn't count either.
   - A capability that requires no confirmation meets this condition trivially.

A capability that fails any condition in any cell is a loss, named with its cell and the condition it failed.

## The grid

**Policies:** every built-in policy of the runtime at the measured commit (`builtInPolicies`): `exhaustive`, `resource`, `progressive` and `advocated`.

**Principals,** hosting-lab's states that change what its views offer:

| principal     | what it is                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| anonymous     | no credential                                                                                           |
| owner, new    | a fresh session's account: a project on Hobby, no deployments                                           |
| owner, on Pro | an account on Pro with one ready deployment and one earlier one, so rollback and every Pro offer appear |

That's 4 × 3 = 12 cells. The capabilities are every capability in hosting-lab's manifest at the measured commit, and an event capability counts only where a view offers it.

## What's reported

- **Per cell:** the capabilities offered, and for each, conditions 1 to 4.
- **The loss:** the count of capabilities that fail in some cell, with their names, cells and failed conditions.
- **The default** this rule gives, and the measured commit.

## The decision (intake, 2026-11-18 13:45Z)

**Generic is WebMCP's default.**

- **The reason, by the rule above:** per-capability isn't lossless. Condition 4 fails for every capability that requires confirmation, in every cell that offers it, because Chromium's WebMCP has no `requestUserInteraction` (SPIKE.md). There's no browser-mediated consent for a tool to ask from inside its execution.
- **With consent failing closed,** such a tool returns the refusal and no approval, so those capabilities aren't reachable as tools.
- **No measurement was needed to decide it:** the failure is by construction, wherever a consequential capability is offered.
- **The loss table,** measured as M7c measured MCP, is still made for M7e's fidelity doc.
