import * as lab from '@affordances/hosting-lab/trial'
import { canonicalJson, digest } from '@affordances/ir'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { projectKeyOf, startLabServer } from './lab-server.ts'
import { decidingFacts, reached, readsViews, t8Depth, walk } from './oracle.ts'
import { checkPin } from './pin.ts'
import { checkMcpPin } from './pins.ts'
import { fakeDriver } from './drivers/fake.ts'
import { readTrace, scoredMetrics, type TrialSpec } from './harness.ts'
import {
  HOST,
  runSurfaceTrial,
  surfacePromptFor,
  toolServerConfig,
  toolServerOf,
} from './surface.ts'
import { surfaces, type SurfaceId } from './surfaces.ts'

// M7f's preflight (surfaces/PLAN.md §2; the planner, 14:38Z and 16:27Z): before any trial, on the pinned export's one
// build, each surface's own tool server is started as a trial starts it, and checked: no instructions, its tool list
// hashed, its first view from the user's project, and the parity oracle's walk reaching every deciding fact. Then the
// checks across cells: one build, the same served site, the same manifest and catalog, the prompt differing only by
// its instruction line, packages/mcp as main's, and one browser. A failing check refuses the run, and the report says
// which and why

export type SurfaceCheck = {
  surface: SurfaceId
  buildId: string
  siteIndex: string // sha256 of the served SiteIndex's bytes
  instructions: string | null
  toolsHash: string
  tools: string[]
  // the first view's start: 'project' when its offers are bound to the trial's project, 'pages' for the surfaces
  // without views (v0, browser), whose first page is the user's own
  firstView: 'project' | 'site-wide' | 'pages'
  found: { fact: string; where: string }[]
  missing: string[]
  browser?: { chromium: string; playwright: string; launchArgs: string[] }
  // T8's depth check (oracle.ts, t8Depth): only on a T8 run
  depth?: { ok: boolean; detail: string }
}
export type Preflight = {
  ok: boolean
  refusals: string[]
  surfaces: SurfaceCheck[]
  manifestDigest: string
  catalog: string
  mcpPin: ReturnType<typeof checkMcpPin>
  exportPin?: ReturnType<typeof checkPin>
  // T8's: each surface's fake trial and the regionSeen its metrics carry
  t8Records?: { surface: SurfaceId; regionSeen: unknown }[]
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

const checkSurface = async (
  id: SurfaceId,
  options: { labBuild: string; port: number; dir: string; task: string },
): Promise<SurfaceCheck> => {
  const surface = surfaces[id]
  const at = (f: string) => path.join(options.dir, `${id}.${f}`)
  const session = `s_preflight_${id}`
  const server = await startLabServer({
    dir: options.labBuild,
    port: options.port,
    plans: ['p1', 'p2', 'p3'],
    session,
    task: options.task,
    stateFile: at('state.json'),
  })
  const client = new Client({ name: 'preflight', version: '0' })
  try {
    const url = `http://${HOST}:${options.port}`
    const project = await projectKeyOf(server.url, session)
    const siteIndex = sha256(await (await fetch(`${url}/.well-known/affordances.json`)).text())
    const config = toolServerConfig(surface, {
      url,
      session,
      task: options.task,
      index: 0,
      project,
      stateFile: at('state.json'),
      out: at('server.json'),
    })
    writeFileSync(at('config.json'), JSON.stringify(config))
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [toolServerOf(surface), at('config.json')],
      }),
    )
    const listed = (await client.listTools()).tools
    const reads = await walk(id, client, url)
    const views = readsViews(id)
    // the first view is from the user's project when its plan offers are bound to it
    const firstView = !views
      ? 'pages'
      : reads[0]!.text.includes(`project=${project}`)
        ? 'project'
        : 'site-wide'
    const { found, missing } = reached(id, await decidingFacts(options.task), reads)
    const depth = options.task === 'T8' ? t8Depth(id, reads) : undefined
    await client.close()
    const record = existsSync(at('server.json'))
      ? (JSON.parse(readFileSync(at('server.json'), 'utf8')) as {
          chromium?: string
          playwright?: string
          launchArgs?: string[]
        })
      : {}
    return {
      surface: id,
      buildId: server.buildId,
      siteIndex,
      instructions: client.getInstructions() ?? null,
      toolsHash: sha256(canonicalJson(listed)),
      tools: listed.map((t) => t.name).toSorted(),
      firstView,
      found,
      missing,
      ...(depth && { depth }),
      ...(record.chromium && {
        browser: {
          chromium: record.chromium,
          playwright: record.playwright!,
          launchArgs: record.launchArgs!,
        },
      }),
    }
  } finally {
    await client.close().catch(() => {})
    await server.stop()
  }
}

/** Every check that fails, named: the per-surface ones, and the ones across cells. A pure function, so each failing case is testable. */
export const refusalsOf = (
  checks: SurfaceCheck[],
  prompts: string[],
  mcpPin?: ReturnType<typeof checkMcpPin>,
  // the pinned export's own check, at every launch and resume (the planner, 17:13Z)
  exportPin?: ReturnType<typeof checkPin>,
  // T8's fake trials, each surface's regionSeen as its metrics carry it
  t8Records?: { surface: SurfaceId; regionSeen: unknown }[],
): string[] => {
  const refusals: string[] = []
  for (const c of checks) {
    if (c.instructions !== null) refusals.push(`${c.surface}: its server sends instructions`)
    if (c.missing.length)
      refusals.push(`${c.surface}: the oracle's walk can't reach ${c.missing.join(', ')}`)
    if (c.firstView === 'site-wide')
      refusals.push(`${c.surface}: its first view isn't from the user's project`)
    if (c.depth && !c.depth.ok) refusals.push(`${c.surface}: T8's depth check: ${c.depth.detail}`)
  }
  const one = (what: string, values: string[]) => {
    if (new Set(values).size > 1)
      refusals.push(`the cells differ in ${what}: ${[...new Set(values)].join(' / ')}`)
  }
  one(
    'the build id',
    checks.map((c) => c.buildId),
  )
  one(
    'the served SiteIndex',
    checks.map((c) => c.siteIndex),
  )
  one(
    'the browser',
    checks.flatMap((c) => (c.browser ? [`${c.browser.chromium} ${c.browser.playwright}`] : [])),
  )
  // the prompt: every surface's is the same bytes but for its instruction line, the second
  const lines = prompts.map((p) => p.split('\n'))
  for (const [i, p] of lines.entries())
    if (p.length !== lines[0]!.length || p.some((line, n) => n !== 1 && line !== lines[0]![n]))
      refusals.push(`${checks[i]?.surface ?? i}: its prompt differs beyond its instruction line`)
  if (exportPin && !exportPin.ok)
    refusals.push(`the pinned export has drifted: ${exportPin.reason}`)
  for (const r of t8Records ?? [])
    if (typeof r.regionSeen !== 'boolean')
      refusals.push(`${r.surface}: a T8 trial's metrics have no regionSeen`)
  if (mcpPin && !mcpPin.ok)
    refusals.push(
      `packages/mcp isn't main's ${mcpPin.commit}: ${mcpPin.differ.map((d) => `${d.file} ${d.reason}`).join(', ')}`,
    )
  return refusals
}

/**
 * T8's record check (the planner, 00:04Z): one fake-driver T8 trial per surface, on the pinned build, scored as a run
 * scores it. Each trace's metrics must carry regionSeen, a boolean; a surface whose trace doesn't is refused.
 */
const t8RecordCheck = async (
  ids: SurfaceId[],
  options: { labBuild: string; port: number; dir: string },
): Promise<{ surface: SurfaceId; regionSeen: unknown }[]> => {
  const dir = path.join(options.dir, 't8-records')
  const out: { surface: SurfaceId; regionSeen: unknown }[] = []
  for (const surface of ids) {
    const spec: TrialSpec = {
      id: `preflight-${surface}-T8`,
      condition: 'A',
      surface,
      task: 'T8',
      model: 'fake',
      driver: 'fake',
      index: 0,
    }
    await runSurfaceTrial(spec, fakeDriver(0, path.join(dir, `${spec.id}.raw.json`)), dir, {
      labBuild: options.labBuild,
      port: options.port,
    })
    out.push({
      surface,
      regionSeen: scoredMetrics(readTrace(path.join(dir, `${spec.id}.jsonl`)))?.regionSeen,
    })
  }
  return out
}

/** The preflight over the surfaces a run will use. Refuses (ok: false) with each failing check named. */
export const surfacePreflight = async (options: {
  labBuild: string
  port: number
  dir: string
  // the tree whose packages/mcp the v0 cell runs: the pinned export's root
  root: string
  // a launch or a resume on the pinned export: its tree must be the pinned bytes (src/pin.ts)
  pinned?: boolean
  surfaces: SurfaceId[]
  // the plan's task: its prompt, its facts and its manifest; T6 for M7f's plans, T8 for M8e's
  task?: string
}): Promise<Preflight> => {
  mkdirSync(options.dir, { recursive: true })
  const taskId = options.task ?? 'T6'
  const checks: SurfaceCheck[] = []
  for (const id of options.surfaces)
    checks.push(await checkSurface(id, { ...options, task: taskId }))
  const task = lab.tasks.find((t) => t.id === taskId)!
  const prompts = options.surfaces.map((s) => surfacePromptFor(surfaces[s], task))
  const mcpPin = checkMcpPin(options.root)
  const exportPin = options.pinned ? checkPin(options.root) : undefined
  const records = taskId === 'T8' ? await t8RecordCheck(options.surfaces, options) : undefined
  const refusals = refusalsOf(
    checks,
    prompts,
    options.surfaces.includes('v0') ? mcpPin : undefined,
    exportPin,
    records,
  )
  return {
    ok: refusals.length === 0,
    refusals,
    surfaces: checks,
    manifestDigest: await digest(lab.manifestFor(taskId, lab.manifest)),
    catalog: sha256(canonicalJson(await decidingFacts(taskId))),
    mcpPin,
    ...(exportPin && { exportPin }),
    ...(records && { t8Records: records }),
  }
}
