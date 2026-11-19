import type { Principal, ResourceResolver } from '@affordances/runtime'
import { addOns, bundles, regions } from '../catalog.ts'
import {
  accountById,
  currentPlans,
  deploymentList,
  findAccount,
  projectAttributes,
  type Account,
} from './store.ts'

// how the runtime reads the store (RFC 0002 §2.1), one resolver per resource type the manifest declares. A caller
// sees only their own project and its deployments: anything else loads as null, as if it didn't exist. Reads look
// accounts up and never make one

// the caller's account, by the id the principal carries: a principal never carries the session's credential
export const accountOf = (principal: Principal): Account | undefined =>
  principal.authenticated && principal.subject ? accountById(principal.subject) : undefined

// the caller's project, the one thing every per-project read needs
export const projectOf = (principal: Principal) => accountOf(principal)?.project

// rows read when asked, so a plan-id assignment made after the resolvers exist still applies
const catalog = <T extends Record<string, unknown>>(
  rows: () => readonly T[],
  key: keyof T,
): ResourceResolver => ({
  load: async (k) => {
    const row = rows().find((r) => r[key] === k)
    return row ? { attributes: { ...row } } : null
  },
  list: async () => rows().map((r) => String(r[key])),
})

export const resolvers: Record<string, ResourceResolver> = {
  'hosting.plan': catalog(currentPlans, 'id'),
  'hosting.addOn': catalog(() => addOns, 'slug'),
  'hosting.bundle': catalog(() => bundles, 'slug'),
  'hosting.region': catalog(() => regions, 'slug'),
  'hosting.project': {
    load: async (key, principal) => {
      const project = projectOf(principal)
      return project && project.id === key ? { attributes: projectAttributes(project) } : null
    },
    list: async (principal) => {
      const project = projectOf(principal)
      return project ? [project.id] : []
    },
  },
  'hosting.deployment': {
    load: async (key, principal) => {
      const project = projectOf(principal)
      const d = project?.deployments.get(key)
      return d && project
        ? { attributes: { id: d.id, projectId: project.id, status: d.status, current: d.current } }
        : null
    },
    list: async (principal) => {
      const project = projectOf(principal)
      return project ? deploymentList(project).map((d) => d.id) : []
    },
  },
}

// the principal the runtime sees for a session: signed in, and named by its account's id, for approvals and the
// declared attribute. A session without an account yet is signed in but owns nothing. No credential, no principal
export const principalFor = (sid: string | null): Principal => {
  if (!sid) return { authenticated: false, attributes: {} }
  const a = findAccount(sid)
  return a
    ? { authenticated: true, subject: a.id, attributes: { id: a.id } }
    : { authenticated: true, attributes: {} }
}
