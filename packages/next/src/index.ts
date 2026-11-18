import { headers } from 'next/headers'
import { redirect as nextRedirect } from 'next/navigation'
import { createAffordances as createCore, type AffordancesOptions } from '@affordances/core'

export { AffordancesError, redirect, type Ctx, type Manifest } from '@affordances/core'

// the UI path reads the request from next's headers() and redirects with next's redirect()
const request = async () => {
  const list = await headers()
  const host = list.get('x-forwarded-host') ?? list.get('host') ?? 'localhost'
  const proto = list.get('x-forwarded-proto') ?? 'http'
  return new Request(`${proto}://${host}/`, { headers: list })
}

// the API's types are core's own, named, not inferred: an inferred type is inlined whole into next's .d.ts, with core's
// import of @standard-schema/spec, a package next doesn't declare. A strict install (vlt, pnpm) or skipLibCheck: false
// then fails on it. Named, the .d.ts refers only to @affordances/core, and the types are the same ones
type Core<Session> = ReturnType<typeof createCore<Session>>

export const createAffordances = <Session = never>(
  options: Pick<AffordancesOptions<Session>, 'auth'> = {},
): Core<Session> => createCore<Session>({ ...options, request, redirect: nextRedirect })

const affordances: Core<never> = createAffordances()
export const defineAction: Core<never>['defineAction'] = affordances.defineAction
export const defineState: Core<never>['defineState'] = affordances.defineState
