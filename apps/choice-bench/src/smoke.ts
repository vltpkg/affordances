import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { claudeCli } from './drivers/claude-cli.ts'
import { codexCli } from './drivers/codex-cli.ts'
import type { Driver } from './drivers/types.ts'

// M5a's smoke test: one real run per driver on a trivial task, counted outside the pilot's trials. Usage:
// node src/smoke.ts <claude|codex> <model> <out dir>
const [which, model, out] = process.argv.slice(2) as [string, string, string]
mkdirSync(out, { recursive: true })
const log = path.join(out, `${which}-server.jsonl`)
rmSync(log, { force: true })
const driver: Driver = which === 'codex' ? codexCli({ root: out }) : claudeCli({ root: out })
const result = await driver.run({
  model,
  prompt: 'Call the lookup tool with the key "color", then reply with only the word it returns.',
  mcp: {
    command: process.execPath,
    args: [path.resolve(import.meta.dirname, 'smoke-server.ts'), log],
  },
  timeoutMs: 180_000,
  maxTurns: 5,
})
let server = ''
try {
  server = readFileSync(log, 'utf8')
} catch {
  // the tool was never called
}
console.log(
  JSON.stringify(
    { driver: driver.id, model, ...result, serverLog: server.trim().split('\n').filter(Boolean) },
    null,
    2,
  ),
)
