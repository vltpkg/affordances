import { cookies } from 'next/headers'

export const getSessionId = async () => (await cookies()).get('sid')?.value ?? null

// sets a sid cookie on first use; only callable where cookies can be written (actions, route handlers)
export const ensureSession = async () => {
  const jar = await cookies()
  const existing = jar.get('sid')?.value
  if (existing) return existing
  const sid = crypto.randomUUID()
  jar.set('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return sid
}
