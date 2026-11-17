import type { Principal, ResourceResolver } from '@affordances/runtime'
import { addOns, bundles } from '../catalog.ts'
import { currentPlans, findAccount, projectAttributes } from './store.ts'

// how the runtime reads the store (RFC 0002 §2.1), one resolver per resource type the manifest declares. A caller
// sees only their own project and its deployments: anything else loads as null, as if it didn't exist. Reads look
// accounts up and never make one

const sidOf = (principal: Principal) => (principal.authenticated ? principal.subject : undefined)

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
  'hosting.project': {
    load: async (key, principal) => {
      const sid = sidOf(principal)
      const project = sid ? findAccount(sid)?.project : undefined
      return project && project.id === key ? { attributes: projectAttributes(project) } : null
    },
    list: async (principal) => {
      const sid = sidOf(principal)
      const project = sid ? findAccount(sid)?.project : undefined
      return project ? [project.id] : []
    },
  },
  'hosting.deployment': {
    load: async (key, principal) => {
      const sid = sidOf(principal)
      const project = sid ? findAccount(sid)?.project : undefined
      const d = project?.deployments.find((x) => x.id === key)
      return d && project
        ? { attributes: { id: d.id, projectId: project.id, status: d.status, current: d.current } }
        : null
    },
    list: async (principal) => {
      const sid = sidOf(principal)
      return (sid ? findAccount(sid)?.project.deployments : undefined)?.map((d) => d.id) ?? []
    },
  },
}

// the principal the runtime sees for a session: signed in, identified for approvals, with the declared attribute
export const principalFor = (sid: string | null): Principal =>
  sid
    ? { authenticated: true, subject: sid, attributes: { id: sid } }
    : { authenticated: false, attributes: {} }
