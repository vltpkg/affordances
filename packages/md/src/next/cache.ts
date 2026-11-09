// markdown.ts's publicCache, as the Cache-Control next sends for a page cached with that cacheLife. no node: imports,
// so the route handler that reads it stays edge-safe
import { perEnv } from './routes.ts'

// a cacheLife profile's times, in seconds
export type Life = { revalidate?: number; expire?: number }

// next's lib/constants.js: "never", as a number that survives JSON, and the s-maxage of a page that never revalidates
const INFINITE_CACHE = 0xfffffffe
const CACHE_ONE_YEAR_SECONDS = 31_536_000

// next's built-in profiles (server/config-shared.js, the same in 16.3.0 and 16.4.3); next.config's cacheLife adds to
// them or replaces one
export const PROFILES: Record<string, Life> = {
  default: { revalidate: 60 * 15, expire: INFINITE_CACHE },
  seconds: { revalidate: 1, expire: 60 },
  minutes: { revalidate: 60, expire: 60 * 60 },
  hours: { revalidate: 60 * 60, expire: 60 * 60 * 24 },
  days: { revalidate: 60 * 60 * 24, expire: 60 * 60 * 24 * 7 },
  weeks: { revalidate: 60 * 60 * 24 * 7, expire: 60 * 60 * 24 * 30 },
  max: { revalidate: 60 * 60 * 24 * 30, expire: 60 * 60 * 24 * 365 },
}

// next's expireTime default (server/config-shared.js): the expire of a page whose cache didn't say one
const EXPIRE_TIME = 31_536_000

// next.config's cacheLife and expireTime, through next's env as md()'s other settings are. Infinity is written as
// next normalizes it (cache-life-profile.js), since JSON has no Infinity
export const CACHE_LIFE_ENV = 'AFFORDANCES_MD_CACHE_LIFE'
type Built = { profiles?: Record<string, Life>; expireTime?: number | null }
const finite = (value: unknown) => (value === Infinity ? INFINITE_CACHE : value)
export const cacheLifeEnv = (cacheLife: unknown, expireTime: unknown): string | undefined => {
  const profiles =
    cacheLife && typeof cacheLife === 'object'
      ? Object.fromEntries(
          Object.entries(cacheLife).map(([name, life]) => [
            name,
            {
              revalidate: finite((life as Life | undefined)?.revalidate),
              expire: finite((life as Life | undefined)?.expire),
            },
          ]),
        )
      : undefined
  const time = typeof expireTime === 'number' ? expireTime : undefined
  return profiles || time !== undefined ? JSON.stringify({ profiles, expireTime: time }) : undefined
}

// the profiles and expireTime the app's config gave, over next's own. a profile that leaves a time out takes the
// default profile's, as a 'use cache' entry does
const settings = perEnv((key: string | undefined) => {
  let built: Built = {}
  try {
    built = JSON.parse(key ?? '{}') as Built
  } catch {}
  const given = built.profiles ?? {}
  const base = { ...PROFILES.default, ...defined(given.default) }
  const profiles: Record<string, Life> = {}
  for (const [name, life] of Object.entries({ ...PROFILES, ...given }))
    profiles[name] = { ...base, ...defined(life) }
  return { profiles, expireTime: built.expireTime ?? EXPIRE_TIME }
})
const defined = (life: Life | undefined) =>
  Object.fromEntries(Object.entries(life ?? {}).filter(([, value]) => typeof value === 'number'))
// spelled out: next inlines process.env.NAME, never process.env[name]
const current = () =>
  settings(process.env.AFFORDANCES_MD_CACHE_LIFE, process.env.AFFORDANCES_MD_CACHE_LIFE)
// the profiles next.config's cacheLife adds to next's own
export const customProfiles = (cacheLife: unknown) =>
  Object.keys(cacheLife && typeof cacheLife === 'object' ? cacheLife : {}).filter(
    (name) => !Object.hasOwn(PROFILES, name),
  )

// the Cache-Control next sends for a page whose cache has this life, in next's own steps (16.3.0 and 16.4.3 alike):
// app-render.js takes a revalidate of INFINITE_CACHE or more as never (false) and such an expire as none; base-server.js
// gives a page with no expire next.config's expireTime; server/lib/cache-control.js getCacheControlHeader writes it
export const cacheControlFor = (
  { revalidate: r, expire: e }: Life,
  expireTime: number | undefined,
) => {
  const revalidate = r === undefined || r >= INFINITE_CACHE ? false : r
  const expire = (e === undefined || e >= INFINITE_CACHE ? undefined : e) ?? expireTime
  const swr =
    typeof revalidate === 'number' && expire !== undefined && revalidate < expire
      ? `, stale-while-revalidate=${expire - revalidate}`
      : ''
  if (revalidate === 0) return 'private, no-cache, no-store, max-age=0, must-revalidate'
  if (typeof revalidate === 'number') return `s-maxage=${revalidate}${swr}`
  return `s-maxage=${CACHE_ONE_YEAR_SECONDS}${swr}`
}

const seconds = (time: unknown) => typeof time === 'number' && time >= 0 && !Number.isNaN(time)
// what's wrong with a publicCache value, or undefined when it's one: a profile's name, or { revalidate, expire? } in
// seconds, expire no less than revalidate (as next's cacheLife() checks)
const cacheProblem = (value: unknown, profiles: string[]): string | undefined => {
  if (typeof value === 'string')
    return profiles.includes(value) ? undefined : `'${value}' isn't a cacheLife profile`
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return "isn't a cacheLife profile or { revalidate, expire? }"
  const extra = Object.keys(value).filter((key) => key !== 'revalidate' && key !== 'expire')
  if (extra.length) return `has ${extra.join(', ')}, which isn't revalidate or expire`
  const { revalidate, expire } = value as Life
  if (!seconds(revalidate)) return 'needs revalidate, in seconds'
  if (expire !== undefined && !seconds(expire)) return "has an expire that isn't seconds"
  if (expire !== undefined && revalidate! > expire)
    return 'has an expire shorter than its revalidate'
  return undefined
}
// what an error about one says it can be
const cacheValues = (profiles: string[]) =>
  `It can be one of Next's cacheLife profiles (${profiles.map((name) => `'${name}'`).join(', ')}) or { revalidate, expire? } in seconds`

// the Cache-Control for a route's publicCache, its problem, or undefined when it says not to cache (revalidate 0, as
// next takes it for a page)
export const publicCacheControl = (value: unknown): { header?: string; problem?: string } => {
  const { profiles, expireTime } = current()
  const problem = cacheProblem(value, Object.keys(profiles))
  if (problem) return { problem: `${problem}. ${cacheValues(Object.keys(profiles))}` }
  const life = typeof value === 'string' ? profiles[value]! : (value as Life)
  const revalidate = finite(life.revalidate ?? profiles.default!.revalidate) as number
  // revalidate 0 is next's dynamic page: nothing to cache
  if (revalidate === 0) return {}
  const expire = finite(life.expire ?? profiles.default!.expire) as number
  return { header: cacheControlFor({ revalidate, expire }, expireTime) }
}
