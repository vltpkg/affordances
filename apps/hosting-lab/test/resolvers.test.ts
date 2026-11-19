import { resolverConformance } from '@affordances/runtime'
import { expect, test } from 'vitest'
import { principalFor, resolvers } from '../src/lib/resolvers.ts'
import * as store from '../src/lib/store.ts'

// the resolver contract (RFC 0002 §2.1; intake, 2026-11-18 16:33Z), checked by the conformance kit: hosting-lab's
// resolvers return a session's project and deployments to that session alone. An app supplies the check's two
// principals as two real accounts, and the private resources each may read

test('hosting-lab’s resolvers pass the kit’s resolver check: each session reads only its own project and deployments', () => {
  store.reset()
  const sessions = ['s_owner_a', 's_owner_b'] as const
  const owners = sessions.map((sid) => {
    const a = store.account(sid)
    const d = store.deploy(a.id, a.project.id, 'main')
    return {
      principal: principalFor(sid),
      reads: {
        'hosting.project': [a.project.id],
        'hosting.deployment': [String((d as { id: string }).id)],
      },
    }
  })
  return resolverConformance({ resources: resolvers, principals: [owners[0]!, owners[1]!] }).then(
    (results) => {
      expect(results.filter((r) => !r.pass)).toEqual([])
      // two principals, two resources each, each loaded three ways and listed two
      expect(results).toHaveLength(2 * 2 * (3 + 2))
    },
  )
})
