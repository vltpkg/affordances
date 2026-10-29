import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DemoEvent, Done, Run } from './race'

// read at request time, never bundled: the recorder keeps adding files while the app runs
export const DIR = path.join(process.cwd(), 'recordings')

export type Listing = {
  id: string
  task: Run['task']
  model: string
  startedAt: string
  done: Pick<Done, 'agent' | 'at' | 'success'>[]
}

export const read = async (id: string) => {
  // ids come from the url: only names already in the folder, so nothing outside it can be read
  const files = await readdir(DIR)
  if (!files.includes(`${id}.json`)) return null
  return JSON.parse(await readFile(path.join(DIR, `${id}.json`), 'utf8')) as { events: DemoEvent[] }
}

// ponytail: parses every file (frames and all) to list them, fine for tens of recordings
export const list = async (): Promise<Listing[]> => {
  const files = (await readdir(DIR).catch(() => [])).filter((f) => f.endsWith('.json')).toSorted()
  const out = await Promise.all(
    files.map(async (file) => {
      const id = file.slice(0, -'.json'.length)
      const { events } = (await read(id))!
      const run = events.find((e) => e.type === 'run')
      if (!run) return null
      const done = events.flatMap((e) =>
        e.type === 'done' ? [{ agent: e.agent, at: e.at, success: e.success }] : [],
      )
      return { id, task: run.task, model: run.model, startedAt: run.startedAt, done }
    }),
  )
  return out.filter((r) => r !== null).toReversed()
}
