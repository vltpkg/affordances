import * as lab from '@affordances/hosting-lab/trial'
import { digest } from '@affordances/ir'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { conditions, type ConditionId } from './conditions.ts'
import { Aborted, createTools, TOOLS, type ToolName } from './tools.ts'
import { setupTrial } from './trial.ts'

// one trial's tool server, as a driver launches it: node src/server.ts <config.json>. One process is one trial. After
// every call it writes the trial's record, so the harness can score a trial however it ends, a cap's kill included

export type ServerConfig = { condition: ConditionId; task: string; index: number; out: string }
export type ServerRecord = {
  condition: ConditionId
  task: string
  index: number
  plans: readonly string[]
  project: string // the trial's project key, which offer ids carry
  manifestDigest: string
  calls: ReturnType<typeof createTools>['calls']
  exposures: ReturnType<typeof createTools>['exposures']
  approvals: ReturnType<typeof createTools>['approvals']
  capped: boolean
  aborted?: string
  endState: lab.EndState
}

const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as ServerConfig
const condition = conditions[config.condition]
const task = lab.tasks.find((t) => t.id === config.task)
if (!task) throw new Error(`no task ${config.task}`)
const trial = await setupTrial(condition, config.index)
const tools = createTools(trial, condition, task)
const manifestDigest = await digest(trial.runtime.manifest)
let aborted: string | undefined

const save = () => {
  const record: ServerRecord = {
    condition: config.condition,
    task: config.task,
    index: config.index,
    plans: trial.plans,
    project: trial.project.key,
    manifestDigest,
    calls: tools.calls,
    exposures: tools.exposures,
    approvals: tools.approvals,
    capped: tools.capped,
    ...(aborted && { aborted }),
    endState: lab.endState(trial.sid),
  }
  writeFileSync(`${config.out}.tmp`, JSON.stringify(record))
  renameSync(`${config.out}.tmp`, config.out)
}
save()

const server = new McpServer({ name: 'bench', version: '0.0.0' })
for (const name of Object.keys(TOOLS) as ToolName[])
  // one loop over the fixed set: the four schemas differ, so the SDK's per-tool typing is widened here
  server.registerTool(
    name,
    TOOLS[name] as { description: string; inputSchema: {} },
    async (input: Record<string, unknown>) => {
      try {
        const { text, error } = await tools.call(name, input)
        return { content: [{ type: 'text' as const, text }], ...(error && { isError: true }) }
      } catch (e) {
        // S showed information A's view lacks: the trial is void, and ends here
        if (e instanceof Aborted) {
          aborted = e.message
          save()
          process.exit(3)
        }
        throw e
      } finally {
        save()
      }
    },
  )
await server.connect(new StdioServerTransport())
