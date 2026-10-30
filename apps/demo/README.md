# demo

A race for a live demo: a browser agent and an Affordances agent do the same shopping task on the same store, on one clock, side by side. Each lane shows what a person would see, what the model actually reads (an accessibility snapshot or a graph/delta, raw, with its size), every turn and tool call with its time, and running turns, tool calls, tokens and cost. The token meter is one segment per turn on the same scale for both lanes: every turn re-reads the whole conversation, so a long run costs more than its last page.

You pick a story, then a task, then a model. The demo plays the newest recording for that choice, and each task button shows its result ("3.1× faster", "tie") so you can lead with the strong ones. The two stories:

- **Affordances agent vs browser**: the browser agent (snapshots, clicks) against an agent that reads the graph and calls actions.
- **Discovery**: the same browser agent twice, one of them in a browser that supports WebMCP. Neither is told Affordances exists; the WebMCP one's system prompt has one extra sentence saying pages can register tools. When a page registers its actions, they slide into that lane's toolbox (orange: they're Affordances actions), drop out again on navigation, and a call to one is marked in the timeline. The summary says which page tools were offered and which were called.

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
vlr record -- --task add-to-cart --agents browser,webmcp   # the discovery story (also change-quantity, search)
```

Each run lands in `apps/demo/recordings/<time>-<task>-<model>.json` (about 600 KB, screenshots inline). The demo reads that folder on every request, so a new recording shows up on reload and replaces the older one for the same story, task and model. Recorded playback needs no network and no API key.

**Live** (header button) runs a real race, either story, through the same recorder, streamed as it happens, on port 3102: it needs `ANTHROPIC_API_KEY` in `apps/bench/.env` and a built `apps/example`, costs real money, and isn't saved. One at a time. The discovery story offers add-to-cart, change-quantity and search only: checkout's confirm action waits for a person to approve it in the browser.

## Present

| Key            | Does                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Space` or `K` | play, pause, replay from the end                                                                                         |
| `←` `→`        | seek a second (`Shift` for five)                                                                                         |
| `Home` `End`   | start, finish                                                                                                            |
| `1` `2` `4`    | speed                                                                                                                    |
| `M`            | methodology: how it ran, how success is checked, fairness, what each agent was told, and the recording's file and commit |
| `Esc`          | close the summary or methodology                                                                                         |

The url holds the choice (`?story=race&task=add-to-cart&model=opus`; `story=discovery` for the other), so you can bookmark exact views; with none it opens on add to cart, Opus, ready to start. A suggested flow: open methodology first (the Affordances agent gets the site index up front; the browser agent gets four tools), close it, play at 1×, and let the gap after the Affordances agent finishes run; the summary appears when both are done. The scrubber shows each agent's model time (faint), tool time (solid) and errors (red) as the race reaches them.

`vlr test` checks that replaying every recording to its end lands on the recorder's own totals.
