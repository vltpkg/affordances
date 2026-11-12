import { readdirSync, readFileSync } from 'node:fs'
import { page } from './corpus/synthetic.mjs'

export type Page = { name: string; html: string; url?: string }

export const cacheDir = new URL('./corpus/.cache/', import.meta.url)

// the cache file name for a url: every non-alphanumeric character becomes _, so it's stable and flat
export const fileName = (url: string) => url.replace(/[^a-zA-Z0-9]/g, '_') + '.html'

export const readUrls = (): string[] =>
  readFileSync(new URL('./corpus/urls.txt', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

// short and readable: the site's main label and the last path segment, e.g. react/useEffect
const shortName = (url: string) => {
  const { hostname, pathname } = new URL(url)
  const labels = hostname.split('.')
  const site = labels.at(-2) ?? hostname
  const last = (pathname.split('/').filter(Boolean).at(-1) ?? '').replace(/\.html?$/, '')
  return last ? `${site}/${last}` : site
}

const synthetic = [50, 200]

export const loadCorpus = (): Page[] => {
  const byFile = new Map(readUrls().map((url) => [fileName(url), url]))
  let files: string[] = []
  try {
    files = readdirSync(cacheDir).filter((file) => file.endsWith('.html'))
  } catch {
    // no cache yet: synthetic pages only, and run.ts says how to fetch
  }
  const pages: Page[] = files.toSorted().map((file) => {
    const url = byFile.get(file)
    const html = readFileSync(new URL(file, cacheDir), 'utf8')
    return url ? { name: shortName(url), html, url } : { name: file.replace(/\.html$/, ''), html }
  })
  for (const sections of synthetic)
    pages.push({ name: `synthetic/${sections}`, html: page(sections) })
  return pages
}

export const filterPages = (pages: Page[], substring: string | undefined) =>
  substring ? pages.filter((p) => p.name.toLowerCase().includes(substring.toLowerCase())) : pages
