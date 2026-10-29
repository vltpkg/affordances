import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Entry } from './catalog'
import { agentsOf, type DemoEvent } from './race'

// read at request time, never bundled: the recorder keeps adding files while the app runs
export const DIR = path.join(process.cwd(), 'recordings')

// the commit that added the file, for the methodology panel; null until it's committed
export type Listing = Entry & { file: string; commit: { sha: string; date: string } | null }

// one git call for the whole folder: newest first, so a file's first mention is its latest commit
const commits = async () => {
  const out = new Map<string, Listing['commit']>()
  const { stdout } = await promisify(execFile)(
    'git',
    ['log', '--format=@%h %cs', '--name-only', '--', '.'],
    { cwd: DIR },
  ).catch(() => ({ stdout: '' }))
  let current: Listing['commit'] = null
  for (const line of stdout.split('\n')) {
    if (line.startsWith('@')) {
      const [sha = '', date = ''] = line.slice(1).split(' ')
      current = { sha, date }
    } else if (line.trim() && !out.has(path.basename(line))) out.set(path.basename(line), current)
  }
  return out
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
  const committed = await commits()
  const out = await Promise.all(
    files.map(async (file) => {
      const id = file.slice(0, -'.json'.length)
      const { events } = (await read(id))!
      const run = events.find((e) => e.type === 'run')
      if (!run) return null
      const done = events.flatMap((e) =>
        e.type === 'done' ? [{ agent: e.agent, at: e.at, success: e.success }] : [],
      )
      return {
        id,
        file: `apps/demo/recordings/${file}`,
        commit: committed.get(file) ?? null,
        task: run.task,
        model: run.model,
        startedAt: run.startedAt,
        agents: agentsOf(events),
        done,
      }
    }),
  )
  return out.filter((r) => r !== null).toReversed()
}
