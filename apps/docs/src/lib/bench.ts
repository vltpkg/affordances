import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const dir = path.join(process.cwd(), '../bench/results')

// committed bench runs, read when the page is prerendered; none until the first run lands
export const benchResults = (): { file: string; data: unknown }[] => {
  let files: string[]
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'))
  } catch {
    return []
  }
  return files.toSorted().map((file) => ({
    file,
    data: JSON.parse(readFileSync(path.join(dir, file), 'utf8')),
  }))
}
