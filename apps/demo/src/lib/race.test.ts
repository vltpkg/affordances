import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { pick, resolve, tasksIn, type Entry } from './catalog.ts'
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

// the picker: any url lands on a race that exists, add to cart on opus first
test('story → task → model resolves to a recording', () => {
  const entries: Entry[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const { events } = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as {
        events: DemoEvent[]
      }
      const run = events.find((e) => e.type === 'run')!
      return {
        id: file,
        task: run.task,
        model: run.model,
        startedAt: run.startedAt,
        agents: agentsOf(events),
        done: [],
      }
    })
  assert.deepEqual(resolve(entries, {}), { story: 'race', task: 'add-to-cart', model: 'opus' })
  assert.deepEqual(resolve(entries, { story: 'discovery', task: 'checkout', model: 'gpt' }), {
    story: 'discovery',
    task: 'add-to-cart',
    model: 'opus',
  })
  for (const story of ['race', 'discovery'] as const)
    for (const task of tasksIn(entries, story))
      assert.ok(pick(entries, resolve(entries, { story, task: task.id })!), `${story}/${task.id}`)
})
