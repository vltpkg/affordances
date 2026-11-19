import * as lab from '@affordances/hosting-lab/trial'
import { digest } from '@affordances/ir'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { BrowserConfig, BrowserRecord } from './browser-server.ts'
import { browserRequestsOf, browsingLoad, firstRequestAt, type BrowserTrial } from './browser.ts'
import { parseAria, planAttributes, showsFact, showsInTree, structured } from './facts.ts'
import type { McpConfig, McpRecord } from './mcp-server.ts'
import {
  declaresElicitation,
  mcpRequestEvent,
  mcpRequestsOf,
  mcpUnauthorized,
  type McpTrial,
} from './mcp.ts'
import { regionSeenIn } from './oracle.ts'
import type { RecordFault } from './record-file.ts'
import { keyOf, uniqueBy, type Request } from './requests.ts'
import { askedToConfirm, responseOf } from './response.ts'
import type { SurfaceServerConfig, SurfaceServerRecord } from './surface-server.ts'
import type { Surface, SurfaceId } from './surfaces.ts'
import { TOOLS } from './tools.ts'
import type { V0Config, V0Record } from './v0-server.ts'
import type { WebMcpConfig, WebMcpRecord } from './webmcp-server.ts'
import { consequential, v0RequestsOf, type CapabilityRequest, type V0Trial } from './v0.ts'

// one adapter per surface kind: what a trial's tool server is, the record it writes, how the runner reads that record,
// and how its requests replay. The runner, the scorer and the replay each ask the surface's adapter, so a new surface
// is one entry here, never a branch in each of them

export type SurfaceRecord =
  | SurfaceServerRecord
  | V0Record
  | BrowserRecord
  | McpRecord
  | WebMcpRecord

/** A harness fault: its class, and what showed it. */
export type FaultInfo = { kind: string; detail: string }

/** The stall a record's faults make (§5), or none: the page's tools, then the browser itself, then a stale ref. */
export const stallOf = (faults: readonly RecordFault[]): FaultInfo | undefined => {
  const of = (kind: RecordFault['kind']) => faults.filter((f) => f.kind === kind)
  const pageTools = of('page-tools')
  const browser = of('browser')
  const refs = of('ref')
  if (pageTools.length)
    return {
      kind: 'stall',
      detail: `the page's tools failed: ${pageTools.map((f) => f.detail).join('; ')}`,
    }
  if (browser.length)
    return {
      kind: 'stall',
      detail: `the browser failed: ${browser.map((f) => f.detail).join('; ')}`,
    }
  if (refs.length)
    return {
      kind: 'stall',
      detail: `a ref from the preceding snapshot didn't resolve: ${refs.map((f) => `${f.tool} ${f.ref}`).join(', ')}`,
    }
  return undefined
}

// a record's faults, from its list, or from the fields a record archived before it keeps
const listed = (record: { harnessFaults?: RecordFault[] }) => record.harnessFaults

/** What the runner (or the preflight) knows of a trial when it writes the tool server's config. */
export type ServerContext = {
  url: string
  session: string
  task: string
  index: number
  project: string
  stateFile: string
  out: string
}

/** What a fresh store needs beside a record to replay it. */
export type ReplayContext = { index: number; task: string; project: string }

/** The record's reads before its first request event: the outputs the facts are matched in, by the surface's form. */
export type RecordReads = {
  calls: number
  // the first request event's index, undefined when there's none
  firstRequest: number | undefined
  // each output before the first request, in the form the surface's matchers read
  before: unknown[]
  unauthorized: boolean
}

export type SurfaceAdapter<R extends SurfaceRecord = SurfaceRecord> = {
  // the tool server's script, beside its config file
  server: string
  config: (
    surface: Surface,
    t: ServerContext,
  ) => SurfaceServerConfig | V0Config | BrowserConfig | McpConfig | WebMcpConfig
  // the record a server writes before its first call, for a trial whose server never started
  emptyRecord: (
    surface: Surface,
    t: {
      url: string
      task: string
      index: number
      plans: readonly string[]
      project: string
      endState: lab.EndState
    },
  ) => Promise<R>
  // the tool names its driver's trace is compared on
  tools: ReadonlySet<string>
  reads: (record: R) => RecordReads
  // whether the Pro plan's bandwidth allowance appears in one of `before`'s outputs
  allowanceSeen: (before: unknown[], gb: unknown) => Promise<boolean>
  // the replay record and, for the browser, its alternate request event
  replay: (record: R, c: ReplayContext) => unknown
  confirmReplay?: (record: R, c: ReplayContext) => unknown
  // the requests a replay record holds, or undefined when the agent never executed anything ('none')
  requests: (record: never) => (Request | CapabilityRequest)[] | undefined
  // the harness faults its server recorded; none on a surface whose server records none
  faults: (record: R) => RecordFault[]
  capped: (record: R) => boolean
  // the trial line's surface-specific evidence, and the metrics line's
  trialEvidence?: (record: R) => Record<string, unknown>
  metrics?: (
    record: R,
    c: { confirmIntended: () => Promise<lab.EndState | undefined>; task: lab.Task },
  ) => Promise<Record<string, unknown>>
}

const script = (name: string) => path.resolve(import.meta.dirname, name)

// the Playwright the harness runs, for a record whose browser never launched
const playwrightVersion = () =>
  (createRequire(import.meta.url)('playwright/package.json') as { version: string }).version

const notLaunched = () => ({
  chromium: 'not launched',
  playwright: playwrightVersion(),
  launchArgs: [] as string[],
})

const replayOf = <R extends object>(record: R, c: ReplayContext) => ({
  ...record,
  condition: 'A' as const,
  index: c.index,
  task: c.task,
  project: c.project,
})

// identical requests (same offer and input) count once: an approved choice is two, and add-on offers share an id
const toolsRequests = (record: SurfaceServerRecord): Request[] =>
  uniqueBy(
    record.calls.flatMap((c) =>
      c.tool === 'execute' && (askedToConfirm(c) || c.state) ? [c.input as Request] : [],
    ),
    keyOf,
  )

const sliced = <C>(calls: C[], first: number) => {
  const firstRequest = first < 0 ? undefined : first
  return { firstRequest, before: calls.slice(0, firstRequest) }
}

const graphAllowance = async (before: unknown[], gb: unknown) =>
  before.some((o) => showsFact(o, 'pro', 'bandwidthGb', gb))

const tools: SurfaceAdapter<SurfaceServerRecord> = {
  server: script('surface-server.ts'),
  config: (surface, t) => ({
    surface: surface.id as 'full' | 'progressive',
    task: t.task,
    index: t.index,
    url: t.url,
    session: t.session,
    project: t.project,
    stateFile: t.stateFile,
    out: t.out,
  }),
  emptyRecord: async (surface, t) => ({
    surface: surface.id as SurfaceServerRecord['surface'],
    condition: surface.condition!.id as SurfaceServerRecord['condition'],
    task: t.task,
    index: t.index,
    plans: t.plans,
    project: t.project,
    manifestDigest: await digest(lab.manifestFor(t.task, lab.manifest)),
    baseDigest: await digest(lab.manifest),
    calls: [],
    exposures: [],
    approvals: [],
    capped: false,
    endState: t.endState,
  }),
  tools: new Set(Object.keys(TOOLS)),
  reads: (record) => {
    const { calls } = record
    const { firstRequest, before } = sliced(
      calls,
      calls.findIndex((c) => c.tool === 'execute' && (askedToConfirm(c) || !!c.state)),
    )
    return {
      calls: calls.length,
      firstRequest,
      before: before.map((c) => structured(c.response)),
      unauthorized: calls.some(
        (c) => c.tool === 'execute' && responseOf(c)?.code === 'unauthorized',
      ),
    }
  },
  allowanceSeen: graphAllowance,
  // the four tools' server record replays as it is
  replay: (record) => record,
  requests: (record: SurfaceServerRecord) =>
    record.calls.some((c) => c.tool === 'execute') ? toolsRequests(record) : undefined,
  faults: () => [],
  capped: (record) => record.capped,
}

const v0: SurfaceAdapter<V0Record> = {
  server: script('v0-server.ts'),
  config: (_, t) => ({ url: t.url, session: t.session, out: t.out }),
  emptyRecord: async (_, t) => ({ surface: 'v0', url: t.url, toolLists: [], calls: [] }),
  tools: new Set(['affordances_open', 'affordances_call']),
  reads: (record) => {
    const { calls } = record
    const { firstRequest, before } = sliced(calls, calls.findIndex(consequential))
    return {
      calls: calls.length,
      firstRequest,
      before: before.map((c) => c.output),
      unauthorized: calls.some(
        (c) =>
          (c.output as { error?: { code?: string } } | undefined)?.error?.code === 'unauthorized',
      ),
    }
  },
  allowanceSeen: graphAllowance,
  replay: (record, c) => replayOf(record, c) satisfies V0Trial,
  requests: (record: V0Trial) =>
    record.calls.some((c) => c.tool === 'affordances_call') ? v0RequestsOf(record) : undefined,
  faults: () => [],
  capped: () => false,
}

// MCP's and WebMCP's generic tools are the same four, refused for confirmation or run, so their records read alike
const genericReads = (record: McpRecord | WebMcpRecord): RecordReads => {
  const { calls } = record
  const { firstRequest, before } = sliced(calls, calls.findIndex(mcpRequestEvent))
  return {
    calls: calls.length,
    firstRequest,
    before: before.map((c) => c.output),
    unauthorized: mcpUnauthorized(record),
  }
}
const genericRequests = (record: McpTrial) =>
  record.calls.some((c) => c.tool === 'execute') ? mcpRequestsOf(record) : undefined

const mcp: SurfaceAdapter<McpRecord> = {
  server: script('mcp-server.ts'),
  config: (_, t) => ({
    url: t.url,
    session: t.session,
    task: t.task,
    project: t.project,
    out: t.out,
  }),
  emptyRecord: async (_, t) => ({
    surface: 'mcp',
    url: t.url,
    clientCapabilities: null,
    clientInfo: null,
    toolLists: [],
    calls: [],
    elicitations: [],
  }),
  tools: new Set(Object.keys(TOOLS)),
  reads: genericReads,
  allowanceSeen: graphAllowance,
  replay: (record, c) => replayOf(record, c) as McpTrial,
  requests: genericRequests,
  faults: () => [],
  capped: () => false,
  // the MCP pilot's finding: whether the client declared elicitation, and what it was asked
  trialEvidence: (record) => ({
    mcp: {
      declaresElicitation: declaresElicitation(record),
      clientCapabilities: record.clientCapabilities,
      clientInfo: record.clientInfo,
      elicitations: record.elicitations,
    },
  }),
  metrics: async (record) => ({ elicitationDeclared: declaresElicitation(record) }),
}

const webmcp: SurfaceAdapter<WebMcpRecord> = {
  server: script('webmcp-server.ts'),
  config: (_, t) => ({ url: t.url, session: t.session, out: t.out }),
  emptyRecord: async (_, t) => ({
    surface: 'webmcp',
    url: t.url,
    ...notLaunched(),
    toolLists: [],
    calls: [],
    completions: [],
    aborted: [],
    harnessFaults: [],
  }),
  tools: new Set(Object.keys(TOOLS)),
  reads: genericReads,
  allowanceSeen: graphAllowance,
  replay: (record, c) => replayOf(record, c) as unknown as McpTrial,
  requests: genericRequests,
  faults: (record) =>
    listed(record) ?? (record.errors ?? []).map((e) => ({ kind: 'page-tools' as const, ...e })),
  capped: () => false,
  // the WebMCP bridge's browser, the same across trials, and the simulated person's completions on the review page
  trialEvidence: (record) => ({
    webmcp: {
      chromium: record.chromium,
      playwright: record.playwright,
      launchArgs: record.launchArgs,
      completions: record.completions,
      aborted: record.aborted,
    },
  }),
}

const browser: SurfaceAdapter<BrowserRecord> = {
  server: script('browser-server.ts'),
  config: (_, t) => ({ url: t.url, session: t.session, out: t.out }),
  emptyRecord: async (_, t) => ({
    surface: 'browser',
    url: t.url,
    ...notLaunched(),
    toolLists: [],
    calls: [],
    loads: [],
    confirms: [],
    aborted: [],
    harnessFaults: [],
  }),
  tools: new Set(['open', 'snapshot', 'click', 'fill', 'submit']),
  reads: (record) => {
    const at = firstRequestAt(record)
    // a call's output came before the first request event when it returned before that review load
    const before = record.calls.filter((c) => at === undefined || c.at + c.ms <= at)
    return {
      calls: record.calls.length,
      firstRequest: at === undefined ? undefined : before.length,
      before: before.map((c) => c.output),
      // the browser reaches no API: a refusal is the page's, never 'unauthorized'
      unauthorized: false,
    }
  },
  // the value in the page's own format, '100 GB', matched as a whole phrase
  allowanceSeen: async (before, gb) => {
    const plans = await Promise.all(
      ['hobby', 'pro', 'business'].map(async (s) => String((await planAttributes(s)).name)),
    )
    const pro = String((await planAttributes('pro')).name)
    return before.some((o) =>
      showsInTree(parseAria(o as string), pro, `${Number(gb).toLocaleString('en')} GB`, plans),
    )
  },
  replay: (record, c) => ({ ...replayOf(record, c), rule: 'first-load' }) satisfies BrowserTrial,
  // the browser's alternate request event: the confirm click with the review-page load just before it
  confirmReplay: (record, c) =>
    ({ ...replayOf(record, c), rule: 'confirm-load' }) satisfies BrowserTrial,
  requests: (record: BrowserTrial) =>
    browserRequestsOf(record, 'first-load').length
      ? browserRequestsOf(record, record.rule)
      : undefined,
  // the browser's two stalls: the browser itself failed, or a ref from the immediately preceding snapshot didn't
  // resolve. A ref the agent invented is its own mistake, told to it, and no stall
  faults: (record) =>
    listed(record) ?? [
      ...(record.errors ?? []).map((e) => ({ kind: 'browser' as const, ...e })),
      ...(record.stalls ?? []).map((r) => ({ kind: 'ref' as const, ...r })),
    ],
  capped: () => false,
  // Chromium's and Playwright's versions, and its flags, none beyond Playwright's, so no WebMCP; and any request to
  // another origin, aborted
  trialEvidence: (record) => ({
    browser: {
      chromium: record.chromium,
      playwright: record.playwright,
      launchArgs: record.launchArgs,
      aborted: record.aborted,
    },
  }),
  metrics: async (record, c) => {
    const alternate = await c.confirmIntended()
    return {
      browsingLoad: browsingLoad(record),
      optimalConfirmLoad:
        !!alternate && lab.groundTruth(c.task).optimal.includes(lab.label(alternate)),
    }
  },
}

// each adapter reads only its own kind's records, which the kind guarantees
const ADAPTERS = { tools, v0, browser, mcp, webmcp } as unknown as Record<
  Surface['kind'],
  SurfaceAdapter
>

/** A surface's adapter, by its kind. */
export const adapterOf = (surface: Pick<Surface, 'kind'>) => ADAPTERS[surface.kind]

const KIND: Record<SurfaceId, Surface['kind']> = {
  full: 'tools',
  progressive: 'tools',
  v0: 'v0',
  browser: 'browser',
  mcp: 'mcp',
  webmcp: 'webmcp',
}
/** A record's adapter, by the surface it names; an M5 record names none, and replays as the four tools'. */
export const adapterOfRecord = (surface: SurfaceId | undefined) =>
  ADAPTERS[surface ? KIND[surface] : 'tools']

/** The facts the runner reads from a record, the same on every surface, each surface reading its own form. */
export const recordFacts = async (
  surface: Surface,
  task: string,
  record: SurfaceRecord,
  endState: lab.EndState,
) => {
  const adapter = adapterOf(surface)
  const gb = (await planAttributes('pro')).bandwidthGb
  const r = adapter.reads(record)
  return {
    surface: surface.id,
    task,
    calls: r.calls,
    firstRequest: r.firstRequest,
    proAllowanceSeen: await adapter.allowanceSeen(r.before, gb),
    ...(task === 'T8' && { regionSeen: r.before.some((o) => regionSeenIn(surface.id, o)) }),
    unauthorized: r.unauthorized,
    endState,
  }
}
