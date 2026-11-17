// re-downloads the real pages listed in corpus/urls.txt into corpus/.cache. existing files are kept unless --force,
// so a refetch is an explicit choice: a site changing its page changes every number
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { cacheDir, fileName, readUrls } from './corpus.ts'

const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } })

mkdirSync(cacheDir, { recursive: true })
let failed = 0
for (const url of readUrls()) {
  const file = new URL(fileName(url), cacheDir)
  if (existsSync(file) && !values.force) {
    console.log(`skip   ${url} (cached; --force to refetch)`)
    continue
  }
  try {
    const res = await fetch(url, {
      headers: {
        // a browser-like agent: some sites serve a stripped page to unknown clients
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        accept: 'text/html',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    writeFileSync(file, html)
    console.log(`fetch  ${url} (${(html.length / 1024).toFixed(0)} KB)`)
  } catch (error) {
    failed++
    console.error(`error  ${url}: ${(error as Error).message}`)
  }
}
if (failed) process.exitCode = 1
