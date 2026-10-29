import { z } from 'zod'

// the protocol's one source: types are inferred from these, and schemas/*.json are generated from them

export const PROTOCOL_VERSION = '0'
export const MEDIA_TYPE = 'application/vnd.afford+json'
export const LINK_REL = 'afford'
export const WELL_KNOWN_PATH = '/.well-known/afford.json'

const JSONSchema = z.record(z.string(), z.unknown()).meta({ description: 'A JSON Schema object' })

export const Expose = z.enum(['public', 'session', 'confirm'])

export const ActionDescriptor = z
  .object({
    name: z.string().min(1).describe('Stable, unique per route'),
    description: z.string(),
    input: JSONSchema,
    output: JSONSchema.optional(),
    expose: Expose,
    guard: z.string().optional().describe('Human-readable precondition'),
    available: z.boolean().describe('The guard, evaluated for this request'),
    reason: z.string().optional().describe('Why the action is unavailable'),
    effects: z.array(z.string()).optional().describe('Entity keys this action changes'),
    readOnly: z.boolean().optional(),
  })
  .meta({ id: 'ActionDescriptor' })

export const NavItem = z.object({
  to: z.string(),
  label: z.string().optional(),
  when: z.string().optional(),
})

export const Graph = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    page: z.string().describe('Concrete path, e.g. /products/tee'),
    route: z.string().describe('Route pattern, e.g. /products/[slug]'),
    entities: z.record(z.string(), z.unknown()),
    actions: z.array(ActionDescriptor),
    nav: z.array(NavItem).optional(),
    md: z.string().optional().describe('Optional Markdown alternative of the page content'),
  })
  .meta({ id: 'Graph' })

export const Call = z
  .object({
    action: z.string().min(1),
    input: z.unknown().optional(),
    confirm: z.boolean().optional(),
  })
  .meta({ id: 'Call' })

export const ErrorCode = z.enum([
  'not_found',
  'invalid_input',
  'unauthorized',
  'confirm_required',
  'unavailable',
  'rate_limited',
  'internal',
])

export const Delta = z
  .object({
    ok: z.boolean(),
    changed: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Only the action's effects keys"),
    output: z
      .unknown()
      .optional()
      .describe("The action's return value, matching its output schema"),
    actionsAdded: z.array(ActionDescriptor).optional(),
    actionsRemoved: z.array(z.string()).optional(),
    redirect: z.string().optional(),
    message: z.string().optional(),
    error: z
      .object({ code: ErrorCode, message: z.string(), issues: z.unknown().optional() })
      .optional(),
  })
  .meta({ id: 'Delta' })

export const AuthMode = z.enum(['cookie', 'bearer'])

// what an action is, without this request's availability: enough to call it straight from the site index
export const ActionSummary = ActionDescriptor.omit({ available: true, reason: true }).meta({
  id: 'ActionSummary',
})

export const SiteIndex = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    name: z.string().optional(),
    routes: z.array(
      z.object({
        route: z.string(),
        description: z.string().optional().describe('What the page is for, in one line'),
        actions: z.array(ActionSummary),
      }),
    ),
    auth: z.array(AuthMode),
    mcp: z.string().optional().describe('URL of an MCP endpoint for this site'),
  })
  .meta({ id: 'SiteIndex' })

export type Expose = z.infer<typeof Expose>
export type ActionDescriptor = z.infer<typeof ActionDescriptor>
export type NavItem = z.infer<typeof NavItem>
export type Graph = z.infer<typeof Graph>
export type Call = z.infer<typeof Call>
export type ErrorCode = z.infer<typeof ErrorCode>
export type Delta = z.infer<typeof Delta>
export type AuthMode = z.infer<typeof AuthMode>
export type ActionSummary = z.infer<typeof ActionSummary>
export type SiteIndex = z.infer<typeof SiteIndex>
