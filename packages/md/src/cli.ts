#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MD_PATH } from './next/index.ts'

const root = process.cwd()
const [command] = process.argv.slice(2)
if (command !== 'init') {
  console.log('usage: afford-md init')
  process.exit(command ? 1 : 0)
}

const app = ['app', 'src/app'].map((dir) => path.join(root, dir)).find((dir) => existsSync(dir))
if (!app) {
  console.error('afford-md  no app directory here')
  process.exit(1)
}
const file = path.join(app, ...MD_PATH.split('/').filter(Boolean), '[[...path]]', 'route.ts')
if (existsSync(file)) console.log(`afford-md  kept ${path.relative(root, file)}`)
else {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, "export { GET } from '@afford/md/next'\n")
  console.log(`afford-md  wrote ${path.relative(root, file)}`)
}
console.log(
  "afford-md  next: wrap next.config with withMd from '@afford/md/next' (or add md() to withAfford's plugins)",
)
