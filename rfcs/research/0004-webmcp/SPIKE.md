# M7d: what Chromium's WebMCP offers, from the spike

**SPIKE:** a throwaway probe, run 2026-11-18 under `~/.cache/affordances-exports/build-design-engineer/webmcp-spike/` and never committed. This records what it found.

## What was run

- **The browser:** Playwright's Chromium **156.0.8078.4**, in both the headless shell and full Chromium headless (`channel: 'chromium'`), driven by `@playwright/test` 1.64.1, the repo's existing devDependency.
- **The page:** a local page, `http://localhost`, which registered one tool and recorded what its `execute` received.
- **The flag sets tried:** none; `--enable-features=WebMCP`; `--enable-features=WebMCPTesting`; both; `--enable-experimental-web-platform-features`; and that with both features.

## What it found

- **Unflagged:** no WebMCP API.
- **With any of the flags,** in both headless modes:
  - **The API:** `document.modelContext` exists, with `registerTool`, `getTools`, `executeTool`, and the `toolchange`, `toolactivated` and `toolcancel` events.
  - **Absent:** `navigator.modelContext` and `navigator.modelContextTesting`.
  - **Registering:** `registerTool({ name, description, inputSchema, execute })` registers a tool. A dotted capability id is accepted as its name.
  - **From outside the page** (Playwright's `evaluate`), `getTools()` lists it, with `name`, `title`, `description`, `inputSchema`, `origin` and `window`. `executeTool(tool, args)` runs it, where `tool` is the object `getTools()` returned and `args` is an object, not JSON text. It returns the tool's result as a JSON string.
- **The consent mechanism is missing:** a tool's `execute(args, client)` receives only `{ signal }`. There's no client object and no `requestUserInteraction`, so the browser-mediated consent RFC 0004 §5 relies on doesn't exist in this build.
- **Headed:** not tested. The host has no display and no Xvfb.

## What follows

- **The harness bridge M7f needs** (list a page's tools, call them, return the results) works headless, with Playwright alone. No new dependency is needed.
- **The consent path** waits for intake's ruling on how WebMCP confirms without `requestUserInteraction`. The planner's recommendation is to fail closed: no tool channel ever yields an approval.
