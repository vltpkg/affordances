#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { findAppDir, generate } from './codegen.ts'
import { API_PATH } from './constants.ts'

const root = process.cwd()
const [command = 'help'] = process.argv.slice(2)
const log = (line: string) => console.log(`afford  ${line}`)

const routeFile = () =>
  path.join(findAppDir(root), ...API_PATH.split('/').filter(Boolean), '[[...path]]', 'route.ts')

const init = () => {
  const file = routeFile()
  if (existsSync(file)) log(`kept ${path.relative(root, file)}`)
  else {
    const manifest = path.relative(path.dirname(file), path.join(root, '.afford', 'manifest'))
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      `import { createRouteHandler } from '@afford/next/route'
import { manifest } from '${manifest}'

const handler = createRouteHandler(manifest)

export { handler as GET, handler as POST }
`,
    )
    log(`wrote ${path.relative(root, file)}`)
  }

  const config = ['next.config.ts', 'next.config.mjs', 'next.config.js'].find((f) =>
    existsSync(path.join(root, f)),
  )
  const source = config && readFileSync(path.join(root, config), 'utf8')
  if (source && !source.includes('withAfford')) {
    const wrapped = source.replace(/export default (\w+)/, 'export default withAfford($1)')
    if (wrapped === source)
      log(`wrap your config: export default withAfford(nextConfig) in ${config}`)
    else {
      writeFileSync(
        path.join(root, config!),
        `import { withAfford } from '@afford/next/config'\n${wrapped}`,
      )
      log(`wrapped ${config} with withAfford`)
    }
  }

  const gitignore = path.join(root, '.gitignore')
  if (!existsSync(gitignore) || !readFileSync(gitignore, 'utf8').split('\n').includes('.afford')) {
    appendFileSync(gitignore, '\n.afford\n')
    log('added .afford to .gitignore')
  }

  generate(root)
  log('generated .afford/manifest.ts')
  log('next: add actions.ts and state.ts next to a page, and set `expose` on each action')
}

if (command === 'init') init()
else if (command === 'build') {
  const entries = generate(root)
  log(`${entries.length} routes → .afford/manifest.ts`)
} else console.log('usage: afford <init|build>')
