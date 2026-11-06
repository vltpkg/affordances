#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MD_PATH } from './next/index.ts'
import { findAppDir } from './next/routes.ts'

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
console.log(
  "affordances-md  next: wrap next.config with withMd from '@affordances/md/next' (or add md() to withAffordances's plugins)",
)
