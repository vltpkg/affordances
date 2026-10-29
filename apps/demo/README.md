# demo

A race for a live demo: a browser agent and an Affordances agent do the same shopping task on the same store, on one clock, side by side. Each lane shows what a person would see, what the model actually reads (an accessibility snapshot or a graph/delta, raw, with its size), every turn and tool call with its time, and running turns, tool calls, tokens and cost. The token meter is one segment per turn on the same scale for both lanes: every turn re-reads the whole conversation, so a long run costs more than its last page.

The data comes from `apps/bench`'s recorder (`src/record.ts`, events typed in `src/events.ts`).

## Run it

```bash
vlt install                # at the repo root, once
cd apps/demo && vlr dev    # http://localhost:3005
```

For the room, prefer a production build: `vlr build && vlr start`.

## Record

```bash
cd apps/example && vlr build              # the recorder starts this build on a fresh store
cd ../bench
vlr record -- --task add-to-cart          # one task; or --task all
vlr record -- --task add-to-cart --model claude-haiku-5-5
```

Each run lands in `apps/demo/recordings/<time>-<task>-<model>.json` (about 600 KB, screenshots inline). The demo reads that folder on every request, so new recordings show up in the picker on reload. Recorded playback needs no network and no API key.

**Live** (header button) runs a real race through the same recorder, streamed as it happens, on port 3102: it needs `ANTHROPIC_API_KEY` in `apps/bench/.env` and a built `apps/example`, costs real money, and isn't saved. One at a time.

## Present

| Key            | Does                                                         |
| -------------- | ------------------------------------------------------------ |
| `Space` or `K` | play, pause, replay from the end                             |
| `←` `→`        | seek a second (`Shift` for five)                             |
| `Home` `End`   | start, finish                                                |
| `1` `2` `4`    | speed                                                        |
| `X`            | x-ray: each model's system prompt and tools, before the task |
| `Esc`          | close the summary or the x-ray                               |

The picker keeps the recording in the url (`?r=<id>`), so a reload lands on the same race. A suggested flow: open the x-ray first (the Affordances agent gets the site index up front; the browser agent gets four tools), close it, play at 1×, and let the gap after the Affordances agent finishes run; the summary appears when both are done. The scrubber shows each agent's model time (faint), tool time (solid) and errors (red) as the race reaches them.

`vlr test` checks that replaying every recording to its end lands on the recorder's own totals.
