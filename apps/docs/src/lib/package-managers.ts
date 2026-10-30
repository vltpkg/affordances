// ported from vlt.io: the preferred package manager lives in a cookie. a plain module (not 'use client') so
// the layout's pre-paint script, the server, and the client hook all read the same names

export const packageManagers = ['vlt', 'npm', 'pnpm', 'yarn', 'bun', 'deno'] as const

export type PackageManager = (typeof packageManagers)[number]

export const isPackageManager = (value: unknown): value is PackageManager =>
  typeof value === 'string' && packageManagers.includes(value as PackageManager)

export const PREFERRED_PM_COOKIE = 'preferred-package-manager'

// what renders with no cookie, and what the markdown twin (a cookieless self-fetch) shows
export const DEFAULT_PREFERRED_PM: PackageManager = 'vlt'

// one year, in seconds
export const PREFERRED_PM_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

// run a package's bin without installing it: `cmd` is the package and its arguments
export const exec = (pm: PackageManager, cmd: string) =>
  ({
    vlt: `vlx ${cmd}`,
    npm: `npx ${cmd}`,
    pnpm: `pnpm dlx ${cmd}`,
    yarn: `yarn dlx ${cmd}`,
    bun: `bunx ${cmd}`,
    deno: `deno run -A npm:${cmd}`,
  })[pm]

// add packages to the project; deno names npm packages with an npm: prefix
export const install = (pm: PackageManager, pkgs: string[], dev = false) => {
  const flag = dev ? '-D ' : ''
  if (pm === 'deno') return `deno add ${flag}${pkgs.map((p) => `npm:${p}`).join(' ')}`
  const verb = {
    vlt: 'vlt install',
    npm: 'npm install',
    pnpm: 'pnpm add',
    yarn: 'yarn add',
    bun: 'bun add',
  }[pm]
  return `${verb} ${flag}${pkgs.join(' ')}`
}

// runs before first paint (from the root layout), so every command already shows the cookie's package
// manager: CSS keys each command's variants off <html data-pm>
export const prePaintScript = `try{var m=document.cookie.match(/(?:^|;\\s*)${PREFERRED_PM_COOKIE}=([^;]+)/);var p=m&&decodeURIComponent(m[1]);if(${JSON.stringify(packageManagers)}.indexOf(p)>-1)document.documentElement.dataset.pm=p}catch(e){}`
