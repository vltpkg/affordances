#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MD_PATH } from './next/index.ts'
import { findAppDir, GENERATED, includesGenerated, withGenerated } from './next/routes.ts'

const root = process.cwd()
const [command] = process.argv.slice(2)
if (command !== 'init') {
  console.log('usage: affordances-md init')
  process.exit(command ? 1 : 0)
}

const app = findAppDir(root)
if (!app) {
  console.error('affordances-md  no app directory here')
  process.exit(1)
}
const file = path.join(app, ...MD_PATH.split('/').filter(Boolean), '[[...path]]', 'route.ts')
if (existsSync(file)) console.log(`affordances-md  kept ${path.relative(root, file)}`)
else {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, "export { GET } from '@affordances/md/next'\n")
  console.log(`affordances-md  wrote ${path.relative(root, file)}`)
}
// the check of each markdown.ts against its route, which tsc runs once include names .affordances/: added here, when
// you ask, never by md() when the config loads
const tsconfig = path.join(root, 'tsconfig.json')
if (existsSync(tsconfig)) {
  const text = readFileSync(tsconfig, 'utf8')
  let has = false
  try {
    has = includesGenerated(text)
  } catch {}
  if (has) console.log('affordances-md  kept tsconfig.json')
  else {
    const edit = withGenerated(text)
    if ('text' in edit) {
      writeFileSync(tsconfig, edit.text)
      console.log(`affordances-md  added "${GENERATED}" to tsconfig.json's include`)
    } else
      console.log(
        `affordances-md  tsconfig.json ${edit.why}: add "${GENERATED}" to its include yourself`,
      )
  }
}
console.log(
  "affordances-md  next: wrap next.config with withMd from '@affordances/md/next' (or add md() to withAffordances's plugins)",
)
