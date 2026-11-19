import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { intendedEndState } from './intended.ts'
import { computeMetrics } from './metrics.ts'
import type { ServerRecord } from './server.ts'
import { scoreSurfaceTrial } from './surface.ts'
import { adapterOf } from './surface-adapters.ts'
import { surfaces, type SurfaceId } from './surfaces.ts'

// intake's standing check (M8, 22:07Z): every committed trace scored again through this commit's code, from what the
// trace keeps (its server record, its end line and the replay records beside it), and its metrics line compared byte
// for byte with the one committed. An M5 trace is scored by computeMetrics, as runTrial scores it; a surface trace by
// scoreSurfaceTrial, as runSurfaceTrial does. A difference names the trace; the check passes only with none

type Line = { kind: string; [key: string]: unknown }
// replay: whether the surface's replay records, rebuilt from the server record by its adapter, are the committed bytes
export type Rescored = { id: string; plan: 'M5' | 'surfaces'; same: boolean; replay?: boolean }

const linesOf = (file: string) => {
  const text = readFileSync(file, 'utf8').trimEnd().split('\n')
  return { text, lines: text.map((l) => JSON.parse(l) as Line) }
}

export const rescoreTrace = async (dir: string, id: string): Promise<Rescored> => {
  const { text, lines } = linesOf(path.join(dir, `${id}.jsonl`))
  const trial = lines.find((l) => l.kind === 'trial')!
  const end = lines.find((l) => l.kind === 'end')!
  const committed = text.at(-1)!
  const record = JSON.parse(readFileSync(path.join(dir, `${id}.server.json`), 'utf8'))
  const usage = end.usage as Parameters<typeof computeMetrics>[1]['usage']
  if (typeof trial.surface === 'string') {
    const surface = surfaces[trial.surface as SurfaceId]
    if (!surface) throw new Error(`${id}: no surface ${trial.surface}`)
    const metrics = await scoreSurfaceTrial({
      surface,
      task: trial.task as string,
      index: trial.index as number,
      record,
      endState: end.endState as Parameters<typeof scoreSurfaceTrial>[0]['endState'],
      replayFile: path.join(dir, `${id}.replay.json`),
      confirmFile: path.join(dir, `${id}.replay-confirm.json`),
      tokens: end.totalTokens as number,
      durationMs: end.durationMs as number,
      end: end.end as Parameters<typeof scoreSurfaceTrial>[0]['end'],
    })
    return {
      id,
      plan: 'surfaces',
      same: JSON.stringify({ kind: 'metrics', ...metrics }) === committed,
      replay: replayRebuilt(dir, id, surface, record, trial),
    }
  }
  const server = path.join(dir, `${id}.server.json`)
  const metrics = computeMetrics(
    record as ServerRecord,
    { usage, durationMs: end.durationMs as number },
    end.end as Parameters<typeof computeMetrics>[2],
    await intendedEndState(server),
  )
  return { id, plan: 'M5', same: JSON.stringify({ kind: 'metrics', ...metrics }) === committed }
}

// the runner writes a surface trace's replay records from its server record (surface-adapters.ts): rebuilt the same
// way, each must be the committed file's bytes, so a change to how they're written can't hide behind committed copies
const replayRebuilt = (
  dir: string,
  id: string,
  surface: (typeof surfaces)[SurfaceId],
  record: unknown,
  trial: Line,
) => {
  const adapter = adapterOf(surface)
  const committed = readFileSync(path.join(dir, `${id}.replay.json`), 'utf8')
  const context = {
    index: trial.index as number,
    task: trial.task as string,
    project: (JSON.parse(committed) as { project?: string }).project ?? '',
  }
  const same = (file: string, value: unknown) =>
    JSON.stringify(value) === readFileSync(path.join(dir, file), 'utf8')
  return (
    same(`${id}.replay.json`, adapter.replay(record as never, context)) &&
    (!adapter.confirmReplay ||
      same(`${id}.replay-confirm.json`, adapter.confirmReplay(record as never, context)))
  )
}

/** Every scored trace in a run's directory (interrupted/ holds no scored trace), a few at a time. */
export const rescoreDir = async (dir: string, concurrency = 4) => {
  const traces = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  const ids = traces
    .filter((f) => existsSync(path.join(dir, f.replace(/\.jsonl$/, '.server.json'))))
    .map((f) => f.replace(/\.jsonl$/, ''))
    .toSorted()
  const out: Rescored[] = []
  const queue = [...ids]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) out.push(await rescoreTrace(dir, id))
    }),
  )
  // a trace with no server record can't be scored again: named, never silently dropped
  const unscorable = traces.map((f) => f.replace(/\.jsonl$/, '')).filter((id) => !ids.includes(id))
  return { rescored: out.toSorted((a, b) => (a.id < b.id ? -1 : 1)), unscorable }
}

// node src/rescore.ts <extracted run dir>…: one line a directory, and the ids that differ; exit 1 on any
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let differ = 0
  for (const dir of process.argv.slice(2)) {
    const { rescored: r, unscorable } = await rescoreDir(dir)
    const bad = r.filter((x) => !x.same)
    const replays = r.filter((x) => x.replay === false)
    differ += bad.length + replays.length + unscorable.length
    console.log(
      JSON.stringify({
        dir,
        traces: r.length,
        identical: r.length - bad.length,
        differ: bad.map((x) => x.id),
        replaysDiffer: replays.map((x) => x.id),
        replaysRebuilt: r.filter((x) => x.replay === true).length,
        unscorable,
      }),
    )
  }
  process.exitCode = differ ? 1 : 0
}
