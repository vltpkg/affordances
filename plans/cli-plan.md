# @affordances/cli

A CLI for adopting Affordances, run as `vlx @affordances/cli` (bin: `affordances`), written in Effect 4 (`effect/cli`, `@effect/platform-node`). Effect is bundled into `dist/cli.js` (~1 MB) rather than installed (~56 MB unpacked), so `vlx` starts fast. Most adopters will be coding agents, so every command takes `--json`, prints `{ ok, ... }` or `{ ok: false, error: { code, message } }`, and exits 1 on failure.

## Done (step 1)

- `init`: the one-line route handler, `withAffordances` in `next.config`, `.affordances` in `.gitignore`, a first manifest. Idempotent; a config it can't wrap becomes a `todo` step, not an edit. Moved from `@affordances/next`, which no longer has a bin and exports its codegen at `@affordances/next/codegen`.
- `build`: regenerate the manifest.
- `open <url>`: the graph as an agent gets it, with an estimated token count (4 characters per token).
- `call <url> <action> [--input] [--confirm] [--token]`: a refused call exits 1.
- Errors are `Schema.TaggedError`s with a `CliError.userMessage` sentence: `NoApp`, `Codegen`, `Unreachable`, `NoGraph`, `BadInput`.

## Next

1. `audit`: coverage per route. Count server actions and controls without an `<Affordance>` (reuse the `require-affordance` rule's detection) and pages without `state.ts`, and give a score ("12% agent-operable") that's worth raising.
2. The skill (`SKILL.md`, published on skills.sh): run `audit`, add `state.ts` and `actions.ts` route by route, wrap the controls, then run `check`. Rules: `expose: 'session'` unless the action is truly public; `confirm` for anything that spends money or deletes; no secrets in state. Migration recipes: a hand-rolled OpenAPI spec, MCP route, or `.md` route into Affordances, then delete the old one. Done when `check` passes and `open` shows the expected actions.
3. `check`: for CI. A token budget per page, actions without `expose` (unreachable by design, but worth a warning), and `public` actions that write.
4. Cookies across `open` and `call` (a `--session` file), so a cart built by one call carries into checkout without a token.

## Not now

- `export` (openapi.json, mcp.json): MCP is served live by `@affordances/mcp`, and llms.txt by `@affordances/md`. Add when a tool needs static files.
- `bench`: needs an API key and Playwright. Keep it in `apps/bench`; if it moves into the CLI, load it lazily.
- `add <route>`: scaffolding from a page's existing server actions. Worth doing after `audit` shows what it would find.
