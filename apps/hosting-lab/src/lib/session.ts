import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionCookieOptions } from './cookie.ts'

export const getSessionId = async () => (await cookies()).get(SESSION_COOKIE)?.value ?? null

// sets a sid cookie on first use; only callable where cookies can be written (actions, route handlers)
export const ensureSession = async () => {
  const jar = await cookies()
  const existing = jar.get(SESSION_COOKIE)?.value
  if (existing) return existing
  const sid = crypto.randomUUID()
  jar.set(SESSION_COOKIE, sid, sessionCookieOptions)
  return sid
}
