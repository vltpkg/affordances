# bench

The same five shopping tasks run against `apps/example`, by two agents on the same model:

- **browser**: drives Chromium through Playwright and reads each page as an accessibility snapshot. Its tools are `goto`, `click`, `fill`, and `press`. A snapshot is far cheaper than a screenshot, so this is a generous baseline.
- **afford**: reads graphs and calls actions through `@afford/mcp`'s client, with two tools: `afford_open` and `afford_call`.

The two agents use the same model (`claude-opus-5-5`) at the same effort. For each run the bench records turns, tool calls, input and output tokens (cache reads and writes count as input), wall time, and success. Success is checked against the store, not taken from the agent's word: the cart and orders of the agent's own session, or the answer text for the question tasks.

| Task              | Prompt                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| `add-to-cart`     | Add a Heavyweight Tee in size M to my cart.                                      |
| `change-quantity` | I want 3 of the Graphite keycap set that is in my cart, not 1. Fix the quantity. |
| `checkout`        | Check out my cart. I approve placing the order.                                  |
| `search`          | What's the cheapest product in stock right now? Tell me its name and price.      |
| `order-status`    | What did I order most recently, and what was the total?                          |

## Run it

```bash
cd apps/example && vlr build          # the bench starts this build itself, fresh for every run
npx playwright install chromium       # once
cd ../bench
vlr bench --dry                       # scripted oracle instead of the model: checks the tasks, costs nothing
ANTHROPIC_API_KEY=… vlr bench --runs 5
```

A run writes `results/<date>.json`, which holds every row plus a per-agent summary (success rate, median turns, tokens, and milliseconds). The docs site's bench page reads these files. Commit the file the numbers came from.

The store keeps stock in memory, so each run starts a fresh `next start` on port 3100 (change it with `--port`). A model refusal or an exhausted 40-turn budget counts as a failed task. There are no refusal fallbacks, because a fallback would let a different model finish the task.
