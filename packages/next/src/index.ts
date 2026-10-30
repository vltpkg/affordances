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

export const createAffordances = <Session = never>(
  options: Pick<AffordancesOptions<Session>, 'auth'> = {},
) => createCore<Session>({ ...options, request, redirect: nextRedirect })

export const { defineAction, defineState } = createAffordances()
