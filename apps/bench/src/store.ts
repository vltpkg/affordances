import { spawn } from 'node:child_process'
import path from 'node:path'

const example = path.join(import.meta.dirname, '../../example')

// the store keeps stock in memory, so each run gets a fresh process (build apps/example first)
export const startStore = async (port: string) => {
  const site = `http://localhost:${port}`
  const store = spawn('node_modules/.bin/next', ['start', '-p', port], {
    cwd: example,
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    if (
      await fetch(site).then(
        (r) => r.ok,
        () => false,
      )
    )
      return store
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  store.kill()
  throw new Error(`apps/example didn't start on ${site}; run \`vlr build\` there first`)
}
