# The inspector

A developer's view of a manifest, and of one projection of it for the signed-in principal: every offer that principal
may see, with the ones a policy's view leaves out marked, the choice sets with their comparisons, and the manifest's
definitions with its derived edges. No RFC specifies it. It's the developer surface RFC 0002 implies: §8.4's "declared
against observed", and §6.3's rule that what a view omits must be findable, are what it makes visible. It's built in
hosting-lab, not as a package.

## Where it lives

| Part                      | Code                                               | Tests                                       |
| ------------------------- | -------------------------------------------------- | ------------------------------------------- |
| the page, `/inspect`      | `apps/hosting-lab/src/app/inspect/page.tsx`        |                                             |
| its data                  | `apps/hosting-lab/src/lib/inspect.ts` (`inspect`)  | `apps/hosting-lab/test/inspect.test.ts`     |
| a choice set's comparison | `apps/hosting-lab/src/components/comparison.tsx`   | `apps/hosting-lab/test/comparison.test.tsx` |
| the gate                  | `apps/hosting-lab/src/lib/gate.ts`, `src/proxy.ts` | `apps/hosting-lab/test/gate.test.ts`        |

## What it shows

- **The offers:** every offer in the projection, each with its availability and why, and whether the chosen policy's
  view shows it ("omitted by progressive"). Offers are never hidden, only marked.
- **The policy:** any of the runtime's built-in policies (`exhaustive`, `resource`, `progressive`, `advocated`), chosen
  by `?policy=`, with `exhaustive` by default ([projection.md](./projection.md#policies-and-views-61-62)).
- **The choice sets,** each with its comparison (RFC 0002 §6.6). A set the view leaves out still shows its comparison,
  one expansion away, since that's what an agent gets once it reaches the set.
- **A facts limit:** `?facts=<cells>`, a request's own limit. Only a request's limit can cut a comparison, so the
  inspector takes one, to show the cut and the columns named as cut.
- **Why a column is never cut:** each comparison column is marked `cited` when a claim shown on the set's members cites
  it, and `read` when the capability's conditions or effects read it, or its confirmation summary renders it.
- **The definitions:** the manifest's sources, principal, resources, capabilities, claims and relations, with the edges
  `derive` finds. They're the same for every request, so they're made once per manifest.

## Its marks are the runtime's rule

The marks come from the runtime's `keptColumns` (`@affordances/runtime`, `@experimental`), called with the claims shown
on the set's members, or none under a policy that omits claims, as the runtime's own views do. So the inspector marks
exactly the columns a view keeps, and adds nothing to the wire.

- **A test holds it there:** under a facts limit of 0, for every set a view shows, on the base manifest and on T6's
  claim edit, the marks equal the columns the comparison keeps. Under `progressive`, the marks cite nothing.
- **Until code review item #9,** the inspector re-implemented the rule, and drifted from it. It counted `target.x` text
  inside the input schema, which the runtime never reads, and every claim on the capability, whatever the policy shows.

## Who can reach it

- **Off by default:** `/inspect` answers only when `HOSTING_LAB_INSPECTOR=1`. The proxy refuses it otherwise, and the
  page checks again, in case a deployment runs without the proxy. Nothing links to it.
- **Why:** it shows a full projection, every offer a principal may see, including what a policy's view omits. RFC 0002
  §11 keeps that off every agent-facing surface, and agents drive this app's pages: the benchmark's browser agent among
  them.
- **For whom:** the signed-in session's own principal. It shows nothing a principal couldn't otherwise find.

## Not built

- **Declared against observed effects.** RFC 0002 §8.4 says the inspector shows them, from an execution result's
  `undeclared` list. As built, it doesn't: it shows no executions. Its relations table marks each relation `declared`,
  which is the manifest's word for where an edge came from, not an observed effect.
- **A packaged inspector** for other apps. It's hosting-lab's page, reading hosting-lab's runtime.

## Related

- [The projection](./projection.md): offers, views, choice sets and the comparison's kept columns.
- [The runtime](./runtime.md): projecting and executing.
