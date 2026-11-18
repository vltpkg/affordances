import * as lab from '@affordances/hosting-lab/trial'
import { digest } from '@affordances/ir'
import type { Principal } from '@affordances/runtime'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { TASK_EDITS } from './conditions.ts'
import { readEndState } from './lab-server.ts'
import { remoteRuntime } from './remote.ts'
import type { ServerRecord } from './server.ts'
import { surfaces } from './surfaces.ts'
import { createTools, TOOLS, type ToolName, type ToolsTrial } from './tools.ts'
import { permutationFor } from './trial.ts'

// the full and progressive surfaces' tool server, as a driver launches it: node src/surface-server.ts <config.json>
// (surfaces/PLAN.md §3). The benchmark's four tools, unchanged from M5 (src/tools.ts), over protocol 1 against the
// trial's own server with its session, instead of an in-process runtime. M5's src/server.ts is left as it ran. The
// record is M5's ServerRecord, with the surface, and its end state is the trial's state file

export type SurfaceServerConfig = {
  surface: 'full' | 'progressive'
  task: string
  index: number
  url: string
  session: string
  // the trial's project key, as its session sees it, read by the runner before the agent's first call: a progressive
  // first view without a start needn't show the project
  project: string
  stateFile: string
  out: string
}
export type SurfaceServerRecord = ServerRecord & { surface: 'full' | 'progressive' }

const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as SurfaceServerConfig
const surface = surfaces[config.surface]
const condition = surface.condition!
const task = lab.tasks.find((t) => t.id === config.task)
if (!task) throw new Error(`no task ${config.task}`)
const runtime = remoteRuntime({ base: `${config.url}/api/projection`, session: config.session })
// the principal is the session's, on the server: what's passed here is never read
const principal = {} as Principal
// the trial's project, which the runner read through the session before the agent's first call
const project = { type: 'hosting.project' as const, key: config.project }
const endState = () => {
  const state = readEndState(config.stateFile, config.session)
  if (!state) throw new Error('the trial’s server wrote no end state for its session')
  return state as lab.EndState
}
const trial: ToolsTrial = {
  runtime,
  principal,
  sid: config.session,
  project,
  plans: permutationFor(config.index),
  request: { start: project, policy: condition.policy.id },
  endState,
}
const tools = createTools(trial, condition, task)
const taskEdit = TASK_EDITS[config.task]
const manifestDigest = await digest(taskEdit ? taskEdit.apply(lab.manifest) : lab.manifest)
const baseDigest = await digest(lab.manifest)

const save = () => {
  const record: SurfaceServerRecord = {
    surface: config.surface,
    condition: condition.id as ServerRecord['condition'],
    task: config.task,
    index: config.index,
    plans: trial.plans,
    project: project.key,
    manifestDigest,
    baseDigest,
    calls: tools.calls,
    exposures: tools.exposures,
    approvals: tools.approvals,
    capped: tools.capped,
    endState: endState(),
  }
  writeFileSync(`${config.out}.tmp`, JSON.stringify(record))
  renameSync(`${config.out}.tmp`, config.out)
}
save()

const server = new McpServer({ name: 'bench', version: '0.0.0' })
for (const name of Object.keys(TOOLS) as ToolName[])
  // one loop over the fixed set, as M5's server: the four schemas differ, so the SDK's per-tool typing is widened
  server.registerTool(
    name,
    TOOLS[name] as { description: string; inputSchema: {} },
    async (input: Record<string, unknown>) => {
      try {
        const { text, error } = await tools.call(name, input)
        return { content: [{ type: 'text' as const, text }], ...(error && { isError: true }) }
      } finally {
        save()
      }
    },
  )
await server.connect(new StdioServerTransport())
