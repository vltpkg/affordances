# capability-demo

One capability, hosting-lab's `hosting.plan.subscribe`, through four transports:

1. **v0**, the page graph (`@affordances/mcp`);
2. **version 1 over HTTP**, the projection route (protocol 1, RFC 0004 §2);
3. **MCP**, `@affordances/mcp-v1`'s generic tools, over protocol 1 to the app (RFC 0004 §4);
4. **WebMCP**, the page's own generic tools, in Chromium with WebMCP's flag (RFC 0004 §5).

For each one, the demo:

- shows the plan comparison the agent is given: the plan choice set's members side by side (RFC 0002 §6.6), or on v0,
  the plans page's entities;
- asks to move the project to Pro, and prints the refusal for confirmation, with the summary the person will approve;
- has the person open the app's own review page, checks that it shows the same summary byte for byte, and confirms
  there;
- reads the project back from the store, and checks it's on Pro.

No transport gives an agent a way to approve. v0 would run the call on the agent's own `confirm: true` resend, which
isn't the person's approval (RFC 0004 §2), so the demo never sends it. On HTTP, the approval token is the host's, for
this exact call, and the demo doesn't use it. MCP and WebMCP return the refusal with no token at all, and the demo checks
every tool result for one.

Each transport gets a fresh session, so each starts on Hobby.

## Run it

From a clean checkout, at the repo root:

```bash
vlt install
cd apps/capability-demo && npx playwright install chromium   # once: the browser WebMCP runs in
cd ../.. && node apps/capability-demo/demo.ts
```

- **The first run builds** what's missing (`vlt run build` at the root, which includes hosting-lab's production build).
  Later runs start at once.
- **WebMCP's flag** is passed by the demo: Chromium is launched with `--enable-features=WebMCP`. Playwright's
  Chromium build is the one it runs in.
- **No network** is used beyond the install: if Chromium isn't installed, the demo prints the command above and stops.
- **The person's browser is headless by default,** and every step prints its evidence, so a run on a machine with no
  display proves itself. The demo exits 0 only if every check passes.

Options:

- `--headed` shows the person's browser;
- `--interactive` waits for you to click Confirm on each review page yourself (implies `--headed`).

## What it starts

hosting-lab's production build, `next start` on a free local port, stopped when the demo exits. Nothing else runs, and
nothing outside the demo's own sessions is changed.
