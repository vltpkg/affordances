import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { agentsOf, duration, lane, sorted, type DemoEvent } from './race.ts'

const dir = path.join(import.meta.dirname, '../../recordings')

// replaying to the end has to land on the recorder's own totals, for every recording on disk
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  test(file, () => {
    const events = sorted(
      (JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { events: DemoEvent[] }).events,
    )
    const run = events.find((e) => e.type === 'run')!
    for (const agent of agentsOf(events)) {
      const done = events.find((e) => e.type === 'done' && e.agent === agent)
      if (done?.type !== 'done' || done.error) continue
      const end = lane(events, agent, duration(events), run.model)
      assert.equal(end.activity.kind, 'done')
      assert.equal(end.turns, done.turns)
      assert.equal(end.toolCalls, done.toolCalls)
      assert.equal(end.tokens, done.tokens)
      assert.ok(Math.abs((end.costUsd ?? 0) - done.costUsd) < 1e-9)
      // just before it finished, it was still working
      assert.notEqual(lane(events, agent, done.at - 1, run.model).activity.kind, 'done')
    }
  })
}
