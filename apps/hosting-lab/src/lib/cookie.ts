// the session cookie, as the proxy (for pages) and the v0 actions (on a first write) both set it
export const SESSION_COOKIE = 'sid'

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
} as const
